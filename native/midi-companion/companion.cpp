#include "CommandReader.hpp"
#include "IngressHandoff.hpp"
#include "MidiCiCodec.hpp"
#include "UmpStreamCodec.hpp"
#include "NativeBatch.hpp"
#include "NativeIo.hpp"
#include "Protocol.hpp"
#include "WindowsUmpEndpoint.hpp"
#include <atomic>
#include <chrono>
#include <libremidi/libremidi.hpp>
#include <map>
#include <memory>
#include <set>
#include <thread>
#include <type_traits>
#include <variant>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
namespace lemmings::companion {
using Clock = std::chrono::steady_clock;
const auto time_origin = Clock::now();
std::uint64_t now_us() {
  return static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() -
                                                            time_origin)
          .count());
}
bool native_api(libremidi::API api) {
  return api == libremidi::API::WINDOWS_MIDI_SERVICES ||
         api == libremidi::API::COREMIDI_UMP ||
         api == libremidi::API::ALSA_SEQ_UMP ||
         api == libremidi::API::ALSA_RAW_UMP;
}
std::string field(std::string_view value) {
  return std::to_string(value.size()) + ":" + std::string(value);
}
template <class Variant> std::string identifier(const Variant &input) {
  return std::visit(
      [](const auto &value) -> std::string {
        using T = std::remove_cvref_t<decltype(value)>;
        if constexpr (std::is_same_v<T, std::string>)
          return field(value);
        else if constexpr (std::is_integral_v<T>)
          return std::to_string(value);
        else if constexpr (requires { value.bytes; }) {
          constexpr char hex[] = "0123456789abcdef";
          std::string result;
          for (const auto byte : value.bytes) {
            result.push_back(hex[byte >> 4]);
            result.push_back(hex[byte & 15]);
          }
          return result;
        } else if constexpr (requires {
                               value.vendor_id;
                               value.product_id;
                             })
          return std::to_string(value.vendor_id) + ":" +
                 std::to_string(value.product_id);
        else
          return "none";
      },
      input);
}
struct Endpoint {
  std::uint32_t token{}, association{};
  bool input{}, windows{}, groups_known{};
  std::uint16_t groups{};
  std::string identity, name, device_name, port_name, windows_device;
  std::string endpoint_metadata, metadata_shape;
  libremidi::input_port in;
  libremidi::output_port out;
};
struct Framer {
  std::array<std::uint32_t, 4> words{};
  std::size_t size{}, wanted{};
  std::int64_t source_ns{};
  std::uint64_t arrival_us{}, loss_generation{};
};
struct Grant {
  std::uint32_t id{}, session{}, endpoint{};
  bool input{}, retiring{}, virtual_port{};
  std::uint16_t groups{};
  std::uint32_t flags{};
  std::string name;
  std::shared_ptr<IngressFence> fence;
  std::unique_ptr<libremidi::midi_in> in;
  std::unique_ptr<libremidi::midi_out> out;
#if defined(LIBREMIDI_WINMIDI)
  std::unique_ptr<WindowsUmpEndpoint> windows;
#endif
  Framer framer;
  std::array<std::uint32_t, 256> channels{};
  std::map<NoteKey, OwnedNote> notes;
  std::set<std::uint32_t> cancelled;
  std::uint64_t ingress_sequence{}, filtered{}, malformed{}, cleanup_unknown{};
  stdx::error write(const std::uint32_t *words, std::size_t count) {
#if defined(LIBREMIDI_WINMIDI)
    if (windows)
      return windows->send_ump(words, count);
#endif
    if (!out)
      return std::errc::not_connected;
    return out->send_ump(words, count);
  }
};
class Companion {
  NativeInput &input_;
  NativeOutput &output_;
  std::shared_ptr<IngressHandoff> handoff_;
  std::shared_ptr<FenceRegistry> fences_;
  std::unique_ptr<libremidi::observer> observer_;
  std::shared_ptr<std::atomic<bool>> inventory_dirty_ =
                                         std::make_shared<std::atomic<bool>>(
                                             true),
                                     backend_fault_ =
                                         std::make_shared<std::atomic<bool>>(
                                             false);
  std::vector<libremidi::API> apis_;
  libremidi::API api_ = libremidi::API::DUMMY;
  std::vector<Endpoint> endpoints_;
  std::map<std::uint32_t, Grant> grants_;
  std::map<std::uint32_t, std::uint64_t> sessions_;
  BatchQueue batches_;
  std::uint32_t next_endpoint_{}, next_grant_{}, latest_session_{},
      inventory_epoch_{};
  std::uint64_t batch_ordinal_{}, active_notes_{}, pending_note_ons_{};
  bool backend_ready_{}, stopping_{};
  IngressBlock incoming_{};
  struct IngressReport {
    std::uint32_t session{}, grant{};
    std::uint64_t first_sequence{};
    std::array<std::uint32_t, 256> words{};
    std::array<std::size_t, 65> offsets{};
    std::array<std::int64_t, 64> timestamps{};
    std::array<std::uint64_t, 64> arrivals{};
    std::array<std::uint32_t, 64> dispatchable{};
    std::size_t words_used{}, packets{};
  } report_;
  void emit(std::string json, bool critical = true) {
    output_.push(std::move(json), critical);
  }
  void reply(std::uint32_t request, std::uint32_t session,
             std::string_view kind, std::string fields = {}) {
    emit("{\"event\":\"receipt\",\"requestId\":" + std::to_string(request) +
         ",\"session\":" + std::to_string(session) + ",\"kind\":" +
         quote(kind) + (fields.empty() ? "" : "," + fields) + "}");
  }
  void error(std::uint32_t request, std::uint32_t session,
             std::string_view reason) {
    reply(request, session, "error", "\"reason\":" + quote(reason));
  }
  void initialize(libremidi::API api) {
    if (!grants_.empty())
      throw std::runtime_error("close-device-grants-before-backend-change");
    observer_.reset();
    backend_ready_ = false;
    api_ = api;
    backend_fault_->store(false);
    libremidi::observer_configuration configuration;
    configuration.track_hardware = true;
    configuration.track_virtual = true;
    configuration.track_network = false;
    configuration.track_any = false;
    configuration.notify_in_constructor = false;
    const auto dirty = inventory_dirty_, fault = backend_fault_;
    configuration.input_added = [dirty](const auto &) { *dirty = true; };
    configuration.input_removed = configuration.input_added;
    configuration.output_added = [dirty](const auto &) { *dirty = true; };
    configuration.output_removed = configuration.output_added;
    configuration.on_error = [fault](auto &&...) { *fault = true; };
    try {
      observer_ = std::make_unique<libremidi::observer>(configuration, api);
      backend_ready_ =
          observer_->get_current_api() == api && !backend_fault_->load();
    } catch (...) {
      observer_.reset();
    }
    inventory_dirty_->store(true);
    refresh_inventory();
  }
  template <class Port> Endpoint endpoint(const Port &port, bool input) {
    Endpoint result;
    result.input = input;
    result.name = port.display_name;
    result.device_name = port.device_name;
    result.port_name = port.port_name;
    result.identity = std::to_string(static_cast<int>(port.api)) + ":" +
                      std::to_string(port.client) + ":" +
                      std::to_string(port.port) + ":" + (input ? "i" : "o") +
                      field(identifier(port.device)) +
                      field(identifier(port.container)) + field(port.serial) +
                      field(port.device_name) + field(port.port_name);
    if constexpr (std::is_same_v<Port, libremidi::input_port>)
      result.in = port;
    else
      result.out = port;
    return result;
  }
  void refresh_inventory() {
    std::vector<Endpoint> next;
    if (backend_ready_) {
#if defined(LIBREMIDI_WINMIDI)
      if (api_ == libremidi::API::WINDOWS_MIDI_SERVICES) {
        for (const auto &device : windows_endpoints())
          for (const bool input : {true, false}) {
            Endpoint row;
            row.input = input;
            row.windows = true;
            row.windows_device = device.device;
            row.name = row.device_name = device.name;
            row.port_name =
                input ? "Native input / control" : "Native output / control";
            row.identity =
                field(device.device) + (input ? ":input" : ":output");
            row.groups_known = device.groups_known;
            row.endpoint_metadata = device.metadata_json; row.metadata_shape = device.metadata_shape;
            row.groups = input ? device.input_groups : device.output_groups;
            next.push_back(std::move(row));
          }
      } else
#endif
      {
        for (const auto &port : observer_->get_input_ports()) {
          if (next.size() >= 1024)
            throw std::runtime_error("endpoint-inventory-capacity");
          next.push_back(endpoint(port, true));
        }
        for (const auto &port : observer_->get_output_ports()) {
          if (next.size() >= 1024)
            throw std::runtime_error("endpoint-inventory-capacity");
          next.push_back(endpoint(port, false));
        }
      }
    }
    for (auto &row : next) {
      const auto old = std::find_if(
          endpoints_.begin(), endpoints_.end(),
          [&](const auto &value) { return value.identity == row.identity; });
      if (old != endpoints_.end())
        row.token = old->token;
      else {
        if (next_endpoint_ == 0xffffffffu)
          throw std::runtime_error("endpoint-identity-exhausted");
        row.token = ++next_endpoint_;
      }
    }
    for (auto &row : next) if (row.windows) {
      const auto peer = std::find_if(next.begin(), next.end(), [&](const auto &candidate) { return candidate.windows && candidate.windows_device == row.windows_device; });
      row.association = peer->token;
    }
    std::vector<std::uint32_t> removed;
    for (const auto &[id, grant] : grants_)
      if (grant.endpoint &&
          std::none_of(next.begin(), next.end(), [&](const auto &row) {
            const auto old = std::find_if(endpoints_.begin(), endpoints_.end(), [&](const auto &previous) { return previous.token == grant.endpoint; });
            return row.token == grant.endpoint && (!row.groups_known || (grant.groups & ~row.groups) == 0) &&
                   (old == endpoints_.end() || old->metadata_shape == row.metadata_shape);
          }))
        removed.push_back(id);
    for (const auto id : removed)
      retire_grant(id, "endpoint-removed");
    endpoints_ = std::move(next);
    if (inventory_epoch_ == 0xffffffffu)
      throw std::runtime_error("inventory-epoch-exhausted");
    ++inventory_epoch_;
    emit("{\"event\":\"ports-changed\",\"inventoryEpoch\":" +
         std::to_string(inventory_epoch_) + "}");
  }
  Grant &grant(std::uint32_t session, std::uint32_t id) {
    const auto found = grants_.find(id);
    if (found == grants_.end() || found->second.session != session ||
        found->second.retiring || !found->second.fence->live.load())
      throw std::runtime_error("device-grant-retired");
    return found->second;
  }
  void release_pending(const PendingBatch &batch) {
    if (pending_note_ons_ >= batch.note_ons.size())
      pending_note_ons_ -= batch.note_ons.size();
    const auto found = grants_.find(batch.grant);
    if (found == grants_.end())
      return;
    for (const auto &key : batch.note_ons) {
      const auto note = found->second.notes.find(key);
      if (note == found->second.notes.end())
        continue;
      if (note->second.pending)
        --note->second.pending;
      if (!note->second.pending && !note->second.active)
        found->second.notes.erase(note);
    }
  }
  template <class Predicate>
  void cancel_batches(Predicate predicate, std::string_view reason) {
    for (const auto &batch : batches_.cancel(predicate)) {
      release_pending(batch);
      reply(batch.request, batch.session, "cancelled",
            "\"grant\":" + std::to_string(batch.grant) +
                ",\"execution\":" + std::to_string(batch.execution) +
                ",\"acceptedPackets\":0,\"acceptedWords\":0,"
                "\"failedPacketUnconfirmed\":false,\"reason\":" +
                quote(reason));
    }
  }

  std::uint64_t cleanup(Grant &owner, std::uint32_t execution = 0) {
    std::uint64_t unknown = 0;
    for (auto at = owner.notes.begin(); at != owner.notes.end();) {
      auto &note = at->second;
      if (execution && note.execution != execution) {
        ++at;
        continue;
      }
      const auto words = note_off(at->first);
      const auto count = at->first.protocol == 4 ? 2u : 1u;
      for (std::uint32_t index = 0; index < note.active; ++index) {
        try {
          if (owner.write(words.data(), count).is_set())
            ++unknown;
        } catch (...) {
          ++unknown;
        }
      }
      active_notes_ -= std::min<std::uint64_t>(active_notes_, note.active);
      note.active = 0;
      if (!note.pending)
        at = owner.notes.erase(at);
      else
        ++at;
    }
    return unknown;
  }
  std::pair<bool, std::uint64_t> retire_grant(std::uint32_t id,
                                              std::string_view reason) {
    const auto found = grants_.find(id);
    if (found == grants_.end())
      return {true, 0};
    if (found->second.retiring)
      return {false, found->second.cleanup_unknown};
    auto &owner = found->second;
    owner.retiring = true;
    owner.fence->live.store(false, std::memory_order_release);
    cancel_batches([&](const auto &batch) { return batch.grant == id; },
                   reason);
    const auto unknown = owner.cleanup_unknown = cleanup(owner);
    bool closed = true;
#if defined(LIBREMIDI_WINMIDI)
    if (owner.windows)
      closed = owner.windows->close();
#endif
    try {
      if (owner.in && owner.in->close_port().is_set())
        closed = false;
    } catch (...) {
      closed = false;
    }
    try {
      if (owner.out && owner.out->close_port().is_set())
        closed = false;
    } catch (...) {
      closed = false;
    }
    fences_->erase(owner.fence);
    emit("{\"event\":\"grant-retired\",\"session\":" +
         std::to_string(owner.session) + ",\"grant\":" + std::to_string(id) +
         ",\"reason\":" + quote(reason) +
         ",\"cleanupUnconfirmedNotes\":" + std::to_string(unknown) +
         ",\"nativeCloseConfirmed\":" + (closed ? "true" : "false") + "}");
    if (closed)
      grants_.erase(found);
    return {closed, unknown};
  }
  void retire_session(std::uint32_t session, std::string_view reason) {
    sessions_.erase(session);
    std::vector<std::uint32_t> ids;
    for (const auto &[id, owner] : grants_)
      if (owner.session == session)
        ids.push_back(id);
    for (const auto id : ids)
      retire_grant(id, reason);
    emit("{\"event\":\"session-retired\",\"session\":" +
         std::to_string(session) + ",\"reason\":" + quote(reason) + "}");
  }
  void open(std::uint32_t request, std::uint32_t session,
            const Endpoint *endpoint, bool input, std::uint16_t groups,
            std::uint32_t flags, std::string name) {
    if (!backend_ready_)
      throw std::runtime_error("native-backend-unavailable");
    if (!groups && !(flags & endpoint_control))
      throw std::invalid_argument("empty-device-grant");
    if (grants_.size() >= 64 || next_grant_ == 0xffffffffu)
      throw std::runtime_error("device-grant-capacity");
    if (endpoint && endpoint->groups_known && (groups & ~endpoint->groups))
      throw std::invalid_argument("group-outside-endpoint-span");
    if (endpoint)
      for (const auto &[id, existing] : grants_)
        if (existing.endpoint == endpoint->token &&
            (input || (groups & existing.groups) ||
             ((flags & existing.flags & endpoint_control) != 0)))
          throw std::runtime_error("endpoint-scope-already-owned");
    Grant value;
    value.id = ++next_grant_;
    value.session = session;
    value.endpoint = endpoint ? endpoint->token : 0;
    value.input = input;
    value.virtual_port = !endpoint;
    value.groups = groups;
    value.flags = flags;
    value.name = std::move(name);
    value.fence = std::make_shared<IngressFence>();
    value.fence->session = session;
    value.fence->grant = value.id;
    value.fence->expires_us = sessions_.at(session);
    if (!fences_->insert(value.fence))
      throw std::runtime_error("device-fence-capacity");
    const auto id = value.id;
    auto &owner = grants_.emplace(id, std::move(value)).first->second;
    try {
#if defined(LIBREMIDI_WINMIDI)
      if (api_ == libremidi::API::WINDOWS_MIDI_SERVICES) {
        owner.windows =
            std::make_unique<WindowsUmpEndpoint>(owner.fence, handoff_, now_us);
        if (endpoint)
          owner.windows->open(endpoint->windows_device, input, groups);
        else
          owner.windows->open_virtual(owner.name, input, groups);
      } else
#endif
          if (input) {
        libremidi::ump_input_configuration configuration;
        const auto fence = owner.fence;
        const auto handoff = handoff_;
        configuration.ignore_sysex = false;
        configuration.ignore_timing = false;
        configuration.ignore_sensing = false;
        configuration.midi1_channel_events_to_midi2 = false;
        configuration.timestamps = libremidi::timestamp_mode::SystemMonotonic;
        configuration.on_raw_data =
            [fence, handoff](std::span<const std::uint32_t> words,
                             libremidi::timestamp time) {
              handoff->push(fence, words, time, now_us());
            };
        configuration.on_error = [fence](auto &&...) { fence->fault = true; };
        configuration.on_warning = configuration.on_error;
        owner.in = std::make_unique<libremidi::midi_in>(configuration, api_);
        if (owner.in->get_current_api() != api_)
          throw std::runtime_error("native-backend-fallback-refused");
        const auto result = endpoint
                                ? owner.in->open_port(endpoint->in, owner.name)
                                : owner.in->open_virtual_port(owner.name);
        if (result.is_set() || !owner.in->is_port_open())
          throw std::runtime_error("native-input-open-refused");
      } else {
        libremidi::output_configuration configuration;
        const auto fence = owner.fence;
        configuration.on_error = [fence](auto &&...) { fence->fault = true; };
        configuration.on_warning = configuration.on_error;
        owner.out = std::make_unique<libremidi::midi_out>(configuration, api_);
        if (owner.out->get_current_api() != api_)
          throw std::runtime_error("native-backend-fallback-refused");
        const auto result =
            endpoint ? owner.out->open_port(endpoint->out, owner.name)
                     : owner.out->open_virtual_port(owner.name);
        if (result.is_set() || !owner.out->is_port_open())
          throw std::runtime_error("native-output-open-refused");
      }
      if (owner.fence->fault.load())
        throw std::runtime_error("native-open-warning-or-error");
      reply(request, session, "opened",
            "\"grant\":" + std::to_string(id) +
                ",\"endpointToken\":" + std::to_string(owner.endpoint) +
                ",\"endpointAssociationToken\":" + (endpoint && endpoint->association ? std::to_string(endpoint->association) : "null") +
                ",\"direction\":" + quote(input ? "input" : "output") +
                ",\"groupMask\":" + std::to_string(groups) +
                ",\"permissions\":" + std::to_string(flags) +
                ",\"virtual\":" + (owner.virtual_port ? "true" : "false") +
                ",\"wireFormat\":\"ump\",\"sourcePrecision\":\"unknown\","
                "\"timestampMode\":" +
                quote(api_ == libremidi::API::WINDOWS_MIDI_SERVICES
                          ? "sdk-clock-nanoseconds"
                          : "system-monotonic-nanoseconds") +
                ",\"activeChannelProtocol\":\"unknown\",\"endpointMetadata\":" +
                (endpoint && !endpoint->endpoint_metadata.empty() ? endpoint->endpoint_metadata : "null"));
    } catch (...) {
      retire_grant(id, "open-failed");
      throw;
    }
  }
  void enqueue(Tokens &input, std::uint32_t request, std::uint32_t session) {
    PendingBatch batch;
    batch.request = request;
    batch.session = session;
    batch.grant = input.number();
    batch.execution = input.number();
    batch.deadline = input.number(maximum_safe_integer);
    batch.priority = static_cast<Priority>(input.number(2));
    const auto count = input.number(ump::maximum_words);
    if (!batch.execution || !count)
      throw std::invalid_argument("empty-batch-or-execution");
    batch.words.reserve(count);
    for (std::size_t index = 0; index < count; ++index)
      batch.words.push_back(
          static_cast<std::uint32_t>(input.number(0xffffffffu, 16)));
    input.finish();
    auto &owner = grant(session, batch.grant);
    if (owner.input)
      throw std::invalid_argument("input-grant-not-writable");
    if (owner.cancelled.contains(batch.execution) ||
        owner.fence->cancellation_requested(batch.execution))
      throw std::runtime_error("execution-cancelled");
    const auto now = now_us();
    if (batch.deadline > now + 2000000 ||
        (batch.deadline + 50000 < now && batch.priority != Priority::release))
      throw std::invalid_argument("native-deadline-outside-horizon");
    if (batch.priority == Priority::control && count > 256)
      throw std::invalid_argument("control-batch-capacity");
    const auto validated = ump::validate_batch(batch.words);
    if (validated.error.code)
      throw std::invalid_argument(validated.error.code);
    auto channels = owner.channels;
    for (const auto &packet : validated.packets) {
      const auto words = std::span<const std::uint32_t>{batch.words}.subspan(
          packet.offset, packet.words);
      if (!permits_packet(words, owner.groups, owner.flags))
        throw std::invalid_argument("packet-outside-device-grant");
      const auto type = words[0] >> 28;
      const auto mutation = note_mutation(words);
      if (batch.priority == Priority::release && (!mutation || mutation->begin))
        throw std::invalid_argument("release-priority-requires-note-off");
      if (type == 2 || type == 4) {
        auto &channel =
            channels[((words[0] >> 24) & 15) * 16 + ((words[0] >> 16) & 15)];
        if (channel && channel != batch.execution)
          throw std::runtime_error("channel-owned-by-another-execution");
        channel = batch.execution;
      }
      if (mutation && mutation->begin)
        batch.note_ons.push_back(mutation->key);
    }
    if (active_notes_ + pending_note_ons_ + batch.note_ons.size() > 8192)
      throw std::runtime_error("native-owned-note-capacity");
    if (const auto failure = batches_.can_admit(batch))
      throw std::runtime_error(failure);
    std::vector<NoteKey> inserted;
    inserted.reserve(batch.note_ons.size());
    try {
      for (const auto &key : batch.note_ons) {
        const auto [at, created] =
            owner.notes.try_emplace(key, OwnedNote{batch.execution, 0, 0});
        if (created)
          inserted.push_back(key);
        else if (at->second.execution != batch.execution)
          throw std::runtime_error("note-owned-by-another-execution");
      }
    } catch (...) {
      for (const auto &key : inserted)
        owner.notes.erase(key);
      throw;
    }
    for (const auto &key : batch.note_ons)
      ++owner.notes.at(key).pending;
    pending_note_ons_ += batch.note_ons.size();
    owner.channels = channels;
    batch.ordinal = ++batch_ordinal_;
    const auto id = batch.grant, execution = batch.execution;
    batches_.insert(std::move(batch));
    reply(request, session, "queued",
          "\"grant\":" + std::to_string(id) +
              ",\"execution\":" + std::to_string(execution) +
              ",\"nativeMonoUs\":" + std::to_string(now));
  }
  void account_packet(Grant &owner, std::span<const std::uint32_t> words,
                      bool uncertain = false) {
    const auto mutation = note_mutation(words);
    if (!mutation)
      return;
    const auto at = owner.notes.find(mutation->key);
    if (at == owner.notes.end())
      return;
    if (mutation->begin) {
      ++at->second.active;
      ++active_notes_;
    } else if (!uncertain && at->second.active) {
      --at->second.active;
      --active_notes_;
    }
  }
  void submit(PendingBatch batch) {
    auto found = grants_.find(batch.grant);
    if (found == grants_.end()) {
      release_pending(batch);
      error(batch.request, batch.session, "device-grant-retired");
      return;
    }
    auto &owner = found->second;
    struct Sender {
      Companion &self;
      Grant &owner;
      const PendingBatch &batch;
      bool entered_driver{};
      const char *refused{};
      stdx::error send_ump(const std::uint32_t *words, std::size_t count) {
        entered_driver = false;
        if (!owner.fence->live.load() || owner.fence->fault.load() ||
            owner.fence->cancellation_requested(batch.execution) ||
            owner.cancelled.contains(batch.execution) ||
            now_us() >= owner.fence->expires_us.load()) {
          refused = "owner-retired-or-cancelled";
          return std::errc::operation_canceled;
        }
        entered_driver = true;
        const auto result = owner.write(words, count);
        if (!result.is_set() && !owner.fence->fault.load())
          self.account_packet(owner, {words, count});
        if (!result.is_set() && owner.fence->fault.load())
          return std::errc::io_error;
        return result;
      }
    } sender{*this, owner, batch};
    const auto began = now_us();
    if (batch.priority != Priority::release && batch.deadline + 50000 < began) {
      release_pending(batch);
      error(batch.request, batch.session, "native-dispatch-deadline-expired");
      return;
    }
    const auto result =
        ump::dispatch(std::span<const std::uint32_t>{batch.words}, sender);
    const bool uncertain =
        result.failed_packet_unconfirmed && sender.entered_driver;
    if (uncertain) {
      const auto offset = result.failure_word_offset;
      account_packet(owner,
                     std::span<const std::uint32_t>{batch.words}.subspan(
                         offset, ump::word_counts[batch.words[offset] >> 28]),
                     true);
    }
    release_pending(batch);
    reply(
        batch.request, batch.session,
        result.reason ? (result.accepted_packets ? "partial" : "rejected")
                      : "driver-submitted",
        "\"grant\":" + std::to_string(batch.grant) +
            ",\"execution\":" + std::to_string(batch.execution) +
            ",\"acceptedPackets\":" + std::to_string(result.accepted_packets) +
            ",\"acceptedWords\":" + std::to_string(result.accepted_words) +
            ",\"failureWordOffset\":" +
            std::to_string(result.failure_word_offset) +
            ",\"failedPacketUnconfirmed\":" + (uncertain ? "true" : "false") +
            ",\"nativeMonoUs\":" + std::to_string(began) + ",\"deadlineUs\":" +
            std::to_string(batch.deadline) + ",\"reason\":" +
            (result.reason
                 ? quote(sender.refused ? sender.refused : result.reason)
                 : "null"));
    if (result.reason && !sender.refused)
      retire_grant(batch.grant, "native-submission-uncertain");
  }

  void flush_ingress() {
    if (!report_.packets)
      return;
    std::string timestamps = "[", arrivals = "[";
    for (std::size_t index = 0; index < report_.packets; ++index) {
      if (index) {
        timestamps += ',';
        arrivals += ',';
      }
      timestamps += quote(std::to_string(report_.timestamps[index]));
      arrivals += std::to_string(report_.arrivals[index]);
    }
    timestamps += ']';
    arrivals += ']';
    std::string offsets = "[";
    for (std::size_t index = 0; index <= report_.packets; ++index) {
      if (index)
        offsets += ',';
      offsets += std::to_string(report_.offsets[index]);
    }
    offsets += ']';
    emit("{\"event\":\"ingress\",\"session\":" +
             std::to_string(report_.session) +
             ",\"grant\":" + std::to_string(report_.grant) +
             ",\"firstSequence\":" + std::to_string(report_.first_sequence) +
             ",\"words\":" +
             words_json({report_.words.data(), report_.words_used}) +
             ",\"offsets\":" + offsets +
             ",\"sourceTimestampNs\":" + timestamps +
             ",\"arrivalMonoUs\":" + arrivals + ",\"dispatchable\":" +
             words_json({report_.dispatchable.data(), report_.packets}) +
             ",\"sourcePrecision\":\"unknown\"" + "}",
         false);
    report_.words_used = report_.packets = 0;
  }
  void receive() {
    std::size_t consumed = 0;
    while (consumed < 8192 && handoff_->pop(incoming_)) {
      consumed += incoming_.count;
      const auto found = grants_.find(incoming_.grant);
      if (found == grants_.end() ||
          found->second.session != incoming_.session ||
          !found->second.fence->live.load())
        continue;
      auto &owner = found->second;
      auto &frame = owner.framer;
      if (frame.loss_generation != incoming_.loss_generation) {
        flush_ingress();
        frame.size = frame.wanted = 0;
        frame.loss_generation = incoming_.loss_generation;
        emit("{\"event\":\"ingress-loss\",\"session\":" +
             std::to_string(owner.session) +
             ",\"grant\":" + std::to_string(owner.id) + ",\"lossGeneration\":" +
             std::to_string(frame.loss_generation) + "}");
      }
      for (std::size_t index = 0; index < incoming_.count; ++index) {
        if (!frame.size) {
          frame.wanted = ump::word_counts[incoming_.words[index] >> 28];
          frame.source_ns = incoming_.source_timestamp_ns;
          frame.arrival_us = incoming_.arrival_us;
        }
        frame.words[frame.size++] = incoming_.words[index];
        if (frame.size != frame.wanted)
          continue;
        const std::span<const std::uint32_t> packet{frame.words.data(),
                                                    frame.size};
        const auto failure = ump::validate_packet(packet);
        const bool framing_only =
            failure && std::string_view(failure) == "unsupported-packet";
        if (failure && !framing_only)
          ++owner.malformed;
        else if (!permits_packet(packet, owner.groups, owner.flags))
          ++owner.filtered;
        else {
          if (report_.packets &&
              (report_.grant != owner.id || report_.packets == 64))
            flush_ingress();
          if (!report_.packets) {
            report_.session = owner.session;
            report_.grant = owner.id;
            report_.first_sequence = owner.ingress_sequence;
            report_.offsets[0] = 0;
          }
          const auto at = report_.packets++;
          std::copy(packet.begin(), packet.end(),
                    report_.words.begin() + report_.words_used);
          report_.words_used += packet.size();
          report_.offsets[report_.packets] = report_.words_used;
          report_.timestamps[at] = frame.source_ns;
          report_.arrivals[at] = frame.arrival_us;
          report_.dispatchable[at] = failure ? 0u : 1u;
          ++owner.ingress_sequence;
        }
        frame.size = frame.wanted = 0;
      }
    }
    flush_ingress();
  }
  void list(std::uint32_t request, std::uint32_t session, Tokens &input) {
    const auto cursor = input.number(1024), limit = input.number(16);
    input.finish();
    if (!limit || cursor > endpoints_.size())
      throw std::invalid_argument("invalid-inventory-page");
    std::string rows = "[";
    const auto end =
        std::min(endpoints_.size(), static_cast<std::size_t>(cursor + limit));
    for (auto at = static_cast<std::size_t>(cursor); at < end; ++at) {
      const auto &row = endpoints_[at];
      if (at != cursor)
        rows += ',';
      rows += "{\"endpointToken\":" + std::to_string(row.token) +
              ",\"name\":" + quote(row.name) +
              ",\"deviceName\":" + quote(row.device_name) +
              ",\"portName\":" + quote(row.port_name) +
              ",\"direction\":" + quote(row.input ? "input" : "output") +
              ",\"groupMask\":" +
              (row.groups_known ? std::to_string(row.groups) : "null") +
              ",\"wireFormat\":\"ump\",\"activeChannelProtocol\":\"unknown\","
              "\"sourcePrecision\":\"unknown\",\"identityScope\":\"current-"
              "native-inventory\"}";
    }
    rows += ']';
    reply(request, session, "endpoints",
          "\"inventoryEpoch\":" + std::to_string(inventory_epoch_) +
              ",\"endpoints\":" + rows + ",\"nextCursor\":" +
              (end < endpoints_.size() ? std::to_string(end) : "null"));
  }
  void handle(std::string_view line) {
    Tokens input{line};
    std::uint32_t request = 0, session = 0;
    try {
      const auto operation = input.take();
      request = input.number();
      session = input.number();
      if (!request)
        throw std::invalid_argument("missing-request-identity");
      if (operation == "Q") {
        input.finish();
        stopping_ = true;
        reply(request, session, "stopping");
        return;
      }
      if (!session)
        throw std::invalid_argument("missing-session-epoch");
      if (operation == "S") {
        input.finish();
        if (session <= latest_session_ || sessions_.size() >= 8)
          throw std::runtime_error("stale-session-or-capacity");
        latest_session_ = session;
        sessions_.emplace(session, now_us() + 5000000);
        reply(request, session, "session-opened");
        return;
      }
      const auto current = sessions_.find(session);
      if (current == sessions_.end() || now_us() >= current->second)
        throw std::runtime_error("session-retired-or-expired");
      if (operation == "H") {
        input.finish();
        current->second = now_us() + 5000000;
        for (auto &[id, owner] : grants_)
          if (owner.session == session && !owner.retiring)
            owner.fence->expires_us = current->second;
        reply(request, session, "heartbeat");
      } else if (operation == "P") {
        input.finish();
        reply(request, session, "clock",
              "\"nativeMonoUs\":" + std::to_string(now_us()) +
                  ",\"domain\":\"companion-steady-microseconds\"");
      } else if (operation == "L")
        list(request, session, input);
      else if (operation == "K" || operation == "Y") {
        const auto id = static_cast<std::uint32_t>(input.number());
        auto &owner = grant(session, id);
        if (!(owner.flags & sysex) ||
            (operation == "K" ? owner.input : !owner.input))
          throw std::runtime_error(
              "ci-codec-requires-permitted-directional-grant");
        if (operation == "K") {
          Tokens checked = input;
          const auto group = checked.number(15);
          if (!(owner.groups & (1u << group)))
            throw std::runtime_error("ci-group-outside-device-grant");
        }
        reply(request, session, operation == "K" ? "ci-encoded" : "ci-decoded",
              operation == "K" ? encode_ci(input) : decode_ci(input));
      } else if (operation == "R" || operation == "T") {
        const auto id = static_cast<std::uint32_t>(input.number());
        auto &owner = grant(session, id);
        if (!(owner.flags & endpoint_control) || (operation == "R" ? owner.input : !owner.input))
          throw std::runtime_error("stream-codec-requires-permitted-directional-grant");
        reply(request, session, operation == "R" ? "stream-encoded" : "stream-decoded", operation == "R" ? encode_stream(input) : decode_stream(input));
      } else if (operation == "A") {
        const auto selected = static_cast<libremidi::API>(input.number(65535));
        input.finish();
        if (std::find(apis_.begin(), apis_.end(), selected) == apis_.end())
          throw std::invalid_argument("native-api-not-compiled");
        initialize(selected);
        reply(request, session, "backend",
              "\"ready\":" + std::string(backend_ready_ ? "true" : "false") +
                  ",\"api\":" + std::to_string(static_cast<int>(api_)));
      } else if (operation == "O") {
        const auto epoch = input.number(), token = input.number();
        const auto groups = static_cast<std::uint16_t>(input.number(65535));
        const auto flags = static_cast<std::uint32_t>(input.number(15));
        input.finish();
        if (epoch != inventory_epoch_)
          throw std::runtime_error("endpoint-inventory-stale");
        const auto found =
            std::find_if(endpoints_.begin(), endpoints_.end(),
                         [&](const auto &row) { return row.token == token; });
        if (found == endpoints_.end())
          throw std::runtime_error("endpoint-unavailable");
        open(request, session, &*found, found->input, groups, flags,
             "Lemmings performance");
      } else if (operation == "V") {
        const bool direction = input.number(1) != 0;
        const auto groups = static_cast<std::uint16_t>(input.number(65535));
        const auto flags = static_cast<std::uint32_t>(input.number(15));
        const auto name = input.hex_text();
        input.finish();
        if (!groups)
          throw std::invalid_argument("virtual-endpoint-requires-group-span");
        open(request, session, nullptr, direction, groups, flags, name);
      } else if (operation == "B")
        enqueue(input, request, session);
      else if (operation == "C") {
        const auto id = static_cast<std::uint32_t>(input.number()),
                   execution = static_cast<std::uint32_t>(input.number());
        input.finish();
        if (!execution)
          throw std::invalid_argument("missing-execution-epoch");
        auto &owner = grant(session, id);
        if (owner.cancelled.size() >= 4096 &&
            !owner.cancelled.contains(execution)) {
          retire_grant(id, "execution-identity-capacity");
          throw std::runtime_error("device-regrant-required");
        }
        owner.cancelled.insert(execution);
        cancel_batches(
            [&](const auto &batch) {
              return batch.grant == id && batch.execution == execution;
            },
            "execution-cancelled");
        const auto unknown = cleanup(owner, execution);
        for (auto &channel : owner.channels)
          if (channel == execution)
            channel = 0;
        owner.fence->finish_cancel(execution);
        reply(request, session, "cancelled-execution",
              "\"grant\":" + std::to_string(id) +
                  ",\"execution\":" + std::to_string(execution) +
                  ",\"cleanupUnconfirmedNotes\":" + std::to_string(unknown));
        if (unknown)
          retire_grant(id, "execution-cleanup-uncertain");
      } else if (operation == "X") {
        const auto id = static_cast<std::uint32_t>(input.number());
        input.finish();
        const auto found = grants_.find(id);
        if (found != grants_.end() && found->second.session != session)
          throw std::runtime_error("device-grant-not-owned");
        const auto retired = retire_grant(id, "explicit-revoke");
        reply(request, session, "closed",
              "\"grant\":" + std::to_string(id) + ",\"nativeCloseConfirmed\":" +
                  (retired.first ? "true" : "false") +
                  ",\"cleanupUnconfirmedNotes\":" +
                  std::to_string(retired.second));
      } else if (operation == "D") {
        input.finish();
        retire_session(session, "session-closed");
        reply(request, session, "session-closed");
      } else
        throw std::invalid_argument("unsupported-command");
    } catch (const std::exception &failure) {
      error(request, session, failure.what());
    } catch (...) {
      error(request, session, "native-command-failed");
    }
  }

public:
  Companion(NativeInput &input, NativeOutput &output,
            std::shared_ptr<IngressHandoff> handoff,
            std::shared_ptr<FenceRegistry> fences)
      : input_{input}, output_{output}, handoff_{std::move(handoff)},
        fences_{std::move(fences)} {
    for (const auto api : libremidi::available_ump_apis())
      if (native_api(api))
        apis_.push_back(api);
    if (!apis_.empty())
      initialize(apis_.front());
  }
  void run() {
    std::string apis = "[";
    for (std::size_t index = 0; index < apis_.size(); ++index) {
      if (index)
        apis += ',';
      const auto api = apis_[index];
      apis += "{\"id\":" + std::to_string(static_cast<int>(api)) +
              ",\"name\":" + quote(libremidi::get_api_name(api)) + "}";
    }
    apis += ']';
    emit("{\"event\":\"ready\",\"protocol\":\"lemmings-native-midi/"
         "v1\",\"compiledApis\":" +
         apis + ",\"backendReady\":" + (backend_ready_ ? "true" : "false") +
         ",\"selectedApi\":" + std::to_string(static_cast<int>(api_)) +
         ",\"libremidiRevision\":\"" LIBREMIDI_REVISION
         "\",\"ciCodec\":\"ni-midi2:" NI_MIDI2_REVISION
         "\",\"ciMaximumMessageBytes\":2048,\"ciMessageReportCodecVersion\":1,\"ciProfileCodecVersion\":1,\"ciPropertyCodecVersion\":1,\"umpStreamCodecVersion\":1,"
         "\"clockDomain\":\"companion-steady-microseconds\","
         "\"maximumWordsPerBatch\":4096,\"maximumPendingBatches\":128,"
         "\"queueHorizonUs\":2000000,\"transportBytesPerSecond\":null,"
         "\"qualification\":\"awaiting-consolidated-validation\"}");
    auto next_inventory = now_us();
    std::mutex sleep_mutex;
    try {
      while (!stopping_ && !input_.ended.load() && !input_.pressure.load() &&
             !output_.pressure.load()) {
        const auto now = now_us();
        std::vector<std::uint32_t> expired;
        for (const auto &[session, expiry] : sessions_)
          if (expiry <= now)
            expired.push_back(session);
        for (const auto id : expired)
          retire_session(id, "application-heartbeat-expired");
        std::vector<std::uint32_t> failed;
        for (const auto &[id, owner] : grants_)
          if (!owner.retiring &&
              (!owner.fence->live.load() || owner.fence->fault.load()))
            failed.push_back(id);
        for (const auto id : failed)
          retire_grant(id, "native-port-fault");
        if (backend_fault_->load()) {
          backend_ready_ = false;
          std::vector<std::uint32_t> ids;
          for (const auto &[id, owner] : grants_)
            if (!owner.retiring)
              ids.push_back(id);
          for (const auto id : ids)
            retire_grant(id, "native-backend-fault");
        }
        if (now >= next_inventory && inventory_dirty_->exchange(false)) {
          refresh_inventory();
          next_inventory = now + 250000;
        }
        std::string line;
        for (unsigned count = 0; count < 32 && input_.pop(line); ++count)
          handle(line);
        for (unsigned count = 0; count < 8; ++count) {
          auto batch = batches_.due(now_us());
          if (!batch)
            break;
          submit(std::move(*batch));
        }
        receive();
        const auto until = batches_.next_deadline(now_us() + 2000);
        std::unique_lock lock(sleep_mutex);
        const auto current = now_us();
        if (until > current)
          handoff_->wake.wait_for(lock,
                                  std::chrono::microseconds(until - current));
      }
    } catch (...) {
      emit("{\"event\":\"fatal\",\"reason\":\"native-owner-failed\"}");
    }
    std::vector<std::uint32_t> sessions;
    for (const auto &[session, expiry] : sessions_)
      sessions.push_back(session);
    for (const auto session : sessions)
      retire_session(session, "companion-stopping");
    grants_.clear();
    observer_.reset();
    emit("{\"event\":\"stopped\"}");
  }
};
} // namespace lemmings::companion

int main() {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  using namespace lemmings::companion;
  NativeInput input;
  NativeOutput output;
  auto handoff = std::make_shared<IngressHandoff>();
  auto fences = std::make_shared<FenceRegistry>();
  std::atomic<bool> stop{false};
  std::thread reader([&] { read_commands(input, *handoff, *fences, stop); });
  int status = 0;
  try {
    Companion companion{input, output, handoff, fences};
    companion.run();
  } catch (...) {
    output.push(
        "{\"event\":\"fatal\",\"reason\":\"native-initialization-failed\"}");
    status = 1;
  }
  stop.store(true, std::memory_order_release);
  reader.join();
  output.close();
  return status;
}
