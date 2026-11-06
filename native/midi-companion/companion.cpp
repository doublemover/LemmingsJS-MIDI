#include "CommandReader.hpp"
#include "IngressHandoff.hpp"
#include "MidiCiCodec.hpp"
#include "UmpStreamCodec.hpp"
#include "NativeBatch.hpp"
#include "NativeControllerRelease.hpp"
#include "NativeJrTiming.hpp"
#include "NativePedalOwnership.hpp"
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
  bool input{}, windows{}, groups_known{}, jr_required{};
  std::uint16_t groups{};
  std::string identity, name, device_name, port_name, windows_device;
  std::string endpoint_metadata, metadata_shape, endpoint_shape;
  std::array<std::string, 16> group_shapes{};
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
  bool input{}, retiring{}, virtual_port{}, jr_required{};
  std::uint16_t groups{}, original_groups{};
  std::uint32_t flags{};
  std::string name;
  std::shared_ptr<IngressFence> fence;
  std::unique_ptr<libremidi::midi_in> in;
  std::unique_ptr<libremidi::midi_out> out;
#if defined(LIBREMIDI_WINMIDI)
  std::unique_ptr<WindowsUmpEndpoint> windows;
#endif
  std::shared_ptr<NativeJrTiming> timing;
  std::uint64_t timing_key{};
  Framer framer;
  std::array<std::uint32_t, 256> channels{};
  std::map<NoteKey, OwnedNote> notes;
  std::set<std::uint32_t> cancelled;
  std::uint64_t ingress_sequence{}, filtered{}, malformed{}, cleanup_unknown{}, cleanup_note_unknown{}, cleanup_control_unknown{};
  std::map<std::uint32_t, ControllerReleasePolicy> controller_policies;
  std::map<std::uint32_t, ControllerReleaseLease> controller_leases;
  std::array<std::uint32_t, 1536> owned_pedals{};
  std::uint16_t owned_pedal_count{};
  bool has_owned_controls() const { return owned_pedal_count != 0 || !controller_leases.empty(); }
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
      inventory_epoch_{}, next_controller_policy_{}, controller_policy_count_{};
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
  std::map<std::uint64_t, std::shared_ptr<NativeJrTiming>> jr_states_;
  std::uint64_t egress_sequence_{};
  struct EgressReport {
    std::uint32_t session{}, grant{}, execution{}, batch{};
    std::string kind;
    std::uint64_t first_sequence{};
    std::array<std::uint32_t, 256> words{};
    std::array<std::size_t, 65> offsets{};
    std::array<std::uint32_t, 64> accepted{}, unconfirmed{};
    std::array<std::uint64_t, 64> began{}, ended{};
    std::size_t words_used{}, packets{};
  } egress_;
  void flush_egress() {
    if (!egress_.packets) return;
    const auto column = [&](const auto &values, std::size_t count) {
      std::string json = "["; for (std::size_t at = 0; at < count; ++at) {
        if (at) json += ','; json += std::to_string(values[at]);
      } return json + "]";
    };
    emit("{\"event\":\"native-driver-observation\",\"session\":" +
      std::to_string(egress_.session) + ",\"grant\":" + std::to_string(egress_.grant) +
      ",\"execution\":" + std::to_string(egress_.execution) +
      ",\"nativeBatchId\":" + std::to_string(egress_.batch) +
      ",\"kind\":" + quote(egress_.kind) + ",\"firstSequence\":" +
      std::to_string(egress_.first_sequence) + ",\"words\":" +
      words_json(std::span<const std::uint32_t>{egress_.words.data(), egress_.words_used}) +
      ",\"offsets\":" + column(egress_.offsets, egress_.packets + 1) +
      ",\"accepted\":" + column(egress_.accepted, egress_.packets) +
      ",\"unconfirmed\":" + column(egress_.unconfirmed, egress_.packets) +
      ",\"beginMonoUs\":" + column(egress_.began, egress_.packets) +
      ",\"endMonoUs\":" + column(egress_.ended, egress_.packets) + "}");
    egress_.packets = egress_.words_used = 0;
  }
  stdx::error observed_write(Grant &owner, std::span<const std::uint32_t> words,
                            std::uint32_t execution, std::uint32_t batch,
                            const char *kind) {
    if (egress_.packets && (egress_.session != owner.session ||
        egress_.grant != owner.id || egress_.execution != execution ||
        egress_.batch != batch || egress_.kind != kind ||
        egress_.packets == 64 || egress_.words_used + words.size() > 256))
      flush_egress();
    if (!egress_.packets) {
      egress_.session = owner.session; egress_.grant = owner.id;
      egress_.execution = execution; egress_.batch = batch;
      egress_.kind = kind; egress_.first_sequence = egress_sequence_;
      egress_.offsets[0] = 0;
    }
    const auto index = egress_.packets++, began = now_us();
    stdx::error result;
    try { result = owner.write(words.data(), words.size()); }
    catch (...) { result = std::errc::io_error; }
    const bool success = !result.is_set() && !owner.fence->fault.load();
    for (const auto word : words) egress_.words[egress_.words_used++] = word;
    egress_.offsets[egress_.packets] = egress_.words_used;
    egress_.accepted[index] = success ? 1 : 0;
    egress_.unconfirmed[index] = success ? 0 : 1;
    egress_.began[index] = began; egress_.ended[index] = now_us();
    if (egress_sequence_ >= maximum_safe_integer)
      throw std::runtime_error("native-driver-trace-identity-exhausted");
    ++egress_sequence_;
    return success ? result : stdx::error{std::errc::io_error};
  }
  bool timing_prefix(Grant &owner, std::uint64_t target, std::uint32_t execution,
                     std::uint32_t batch, NativeJrEnvelope &envelope,
                     bool emergency = false) {
    if (!owner.timing || !owner.timing->enabled) return true;
    auto &timing = *owner.timing;
    if (timing.failed && !emergency) return false;
    const auto began = now_us(); envelope = jr_envelope(timing, target, began);
    bool success = true;
    for (std::size_t at = 0; at < envelope.count; ++at) {
      if (!emergency && (!owner.fence->live.load() ||
          owner.fence->cancellation_requested(execution) ||
          owner.cancelled.contains(execution))) return false;
      const auto word = envelope.words[at];
      const bool accepted = !observed_write(owner, {&word, 1}, execution, batch,
        (word & 0x00f00000) == 0x00100000 ? "jr-clock" : "jr-timestamp").is_set();
      if (accepted) { ++envelope.accepted; if ((word & 0x00f00000) == 0x00100000) timing.last_clock_us = began; }
      else { success = false; timing.failed = true; envelope.failed_unconfirmed = true; if (!emergency) break; }
    }
    if (success) { timing.last_stamp_tick = envelope.represented_tick; timing.stamp_valid = true; }
    return success;
  }
  void jr_clocks(std::uint64_t at) {
    for (const auto &[key, timing] : jr_states_) {
      if (!timing->enabled || timing->failed || (timing->last_clock_us && at - timing->last_clock_us < 200000)) continue;
      const auto found = std::find_if(grants_.begin(), grants_.end(), [&](const auto &row) {
        return !row.second.input && !row.second.retiring &&
          row.second.timing == timing && row.second.fence->live.load() &&
          !row.second.fence->fault.load();
      });
      if (found == grants_.end()) continue;
      auto &owner = found->second; const auto instant = now_us(); const auto word = jr_clock_word(instant);
      if (observed_write(owner, {&word, 1}, 0, 0, "jr-clock").is_set()) { timing->failed = true; owner.fence->fault = true; }
      else timing->last_clock_us = instant;
    }
    flush_egress();
  }
  void set_jr_mode(std::uint32_t request, std::uint32_t session, Tokens &input) {
    const auto id = static_cast<std::uint32_t>(input.number()); const auto mode = input.number(1);
    input.finish(); auto &owner = grant(session, id);
    if (mode && api_ == libremidi::API::WINDOWS_MIDI_SERVICES) throw std::runtime_error("windows-midi-services-forbids-application-jr-generation");
    if (owner.input || !(owner.flags & endpoint_control) || !owner.timing)
      throw std::runtime_error("jr-policy-requires-endpoint-control-output");
    auto &timing = *owner.timing;
    if (timing.failed) throw std::runtime_error("jr-clock-failed-reopen-endpoint");
    if (timing.enabled != (mode != 0)) {
      for (const auto &[grant_id, peer] : grants_) if (!peer.retiring && peer.timing == owner.timing) {
        if (!peer.notes.empty() || peer.has_owned_controls() || batches_.has_grant(grant_id))
          throw std::runtime_error("stop-all-owned-endpoint-scopes-before-jr-policy-change");
      }
      timing.enabled = mode != 0; timing.stamp_valid = false;
      if (timing.enabled) {
        const auto instant = now_us(); const auto word = jr_clock_word(instant);
        if (observed_write(owner, {&word, 1}, 0, request, "jr-clock").is_set()) {
          timing.failed = true; owner.fence->fault = true;
          throw std::runtime_error("jr-initial-clock-submission-unconfirmed");
        }
        timing.last_clock_us = instant;
      }
    }
    if (timing.control_grant == id && timing.control_session == session) timing.control_confirmed = true;
    flush_egress();
    reply(request, session, "jr-policy", "\"grant\":" + std::to_string(id) +
      ",\"enabled\":" + (timing.enabled ? "true" : "false") +
      ",\"clockDomain\":\"companion-steady-microseconds\",\"tickUs\":32");
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
            row.groups_known = device.groups_known; row.jr_required = device.jr_required;
            row.endpoint_metadata = device.metadata_json; row.metadata_shape = device.metadata_shape; row.endpoint_shape = device.endpoint_shape; row.group_shapes = device.group_shapes;
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
    std::vector<std::tuple<std::uint32_t, std::uint16_t, std::string>> changed_groups;
    for (const auto &[id, owner] : grants_) if (owner.endpoint) {
      const auto next_row = std::find_if(next.begin(), next.end(), [&](const auto &row) { return row.token == owner.endpoint; });
      const auto old = std::find_if(endpoints_.begin(), endpoints_.end(), [&](const auto &row) { return row.token == owner.endpoint; });
      if (next_row == next.end() || (old != endpoints_.end() && old->endpoint_shape != next_row->endpoint_shape)) { removed.push_back(id); continue; }
      std::uint16_t affected = next_row->groups_known ? static_cast<std::uint16_t>(owner.groups & ~next_row->groups) : 0;
      if (old != endpoints_.end()) for (unsigned group = 0; group < 16; ++group) if ((owner.groups & (1u << group)) && old->group_shapes[group] != next_row->group_shapes[group]) affected |= static_cast<std::uint16_t>(1u << group);
      if (affected) changed_groups.emplace_back(id, affected, next_row->endpoint_metadata);
    }
    for (const auto &[id, groups, metadata] : changed_groups) retire_groups(id, groups, metadata);
    for (const auto id : removed) retire_grant(id, "endpoint-removed-or-global-protocol-changed");
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
  void reap_controller_release(Grant &owner, std::uint32_t id) {
    const auto lease = owner.controller_leases.find(id);
    if (lease != owner.controller_leases.end() && !lease->second.active && !lease->second.selector_dirty && !lease->second.pending) owner.controller_leases.erase(lease);
    const auto policy = owner.controller_policies.find(id);
    if (policy != owner.controller_policies.end() && policy->second.retired && !owner.controller_leases.contains(id)) { owner.controller_policies.erase(policy); --controller_policy_count_; }
  }
  void account_controller_release(Grant &owner, const PendingBatch &batch, std::size_t offset, bool uncertain) {
    const auto start = std::lower_bound(batch.controller_actions.begin(), batch.controller_actions.end(), offset, [](const auto &action, auto offset) { return action.offset < offset; });
    for (auto at = start; at != batch.controller_actions.end() && at->offset == offset; ++at) {
      const auto found = owner.controller_leases.find(at->policy); if (found == owner.controller_leases.end()) continue;
      auto &lease = found->second;
      if (at->selector_touch) lease.selector_dirty = true;
      if (at->arm) lease.active = true;
      if (!uncertain) { if (at->disarm) lease.active = false; if (at->selector_clear) lease.selector_dirty = false; }
    }
  }
  bool cleanup_controller_release(Grant &owner, std::uint32_t id) {
    const auto found = owner.controller_leases.find(id); if (found == owner.controller_leases.end() || (!found->second.active && !found->second.selector_dirty)) return false;
    auto &lease = found->second; const auto policy_at = owner.controller_policies.find(id); if (policy_at == owner.controller_policies.end()) return true;
    const auto policy = policy_at->second; bool confirmed = true;
    try {
      NativeJrEnvelope envelope{}; confirmed = timing_prefix(owner, now_us(), lease.execution, 0, envelope, true);
      const auto first = lease.active ? 0u : policy.count - 2u;
      for (std::size_t offset = first; offset < policy.count;) {
        const auto count = ump::word_counts[policy.reset[offset] >> 28];
        if (observed_write(owner, {policy.reset.data() + offset, count}, lease.execution, 0, "owned-controller-cleanup").is_set()) { confirmed = false; break; }
        offset += count;
      }
    } catch (...) { confirmed = false; }
    if (confirmed) lease.active = lease.selector_dirty = false;
    return !confirmed;
  }
  void release_pending(const PendingBatch &batch) {
    if (pending_note_ons_ >= batch.note_ons.size())
      pending_note_ons_ -= batch.note_ons.size();
    const auto found = grants_.find(batch.grant);
    if (found == grants_.end())
      return;
    for (const auto id : batch.controller_policies) { const auto lease = found->second.controller_leases.find(id); if (lease != found->second.controller_leases.end() && lease->second.pending) --lease->second.pending; reap_controller_release(found->second, id); }
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

  CleanupCount cleanup(Grant &owner, std::uint32_t execution = 0) {
    CleanupCount unknown;
    for (auto at = owner.controller_leases.begin(); at != owner.controller_leases.end();) { const auto id = at->first, owned_execution = at->second.execution; ++at; if (!execution || owned_execution == execution) { if (cleanup_controller_release(owner, id)) ++unknown.controls; reap_controller_release(owner, id); } }
    for (std::size_t index = 0; index < owner.owned_pedals.size() && owner.owned_pedal_count; ++index) {
      const auto lease = owner.owned_pedals[index]; if (!lease || (execution && lease != execution)) continue;
      const auto words = pedal_release(index); const auto count = index >= 768 ? 2u : 1u;
      try {
        NativeJrEnvelope envelope{}; const bool timing = timing_prefix(owner, now_us(), lease, 0, envelope, true);
        if (observed_write(owner, {words.data(), count}, lease, 0, "owned-controller-cleanup").is_set() || !timing) ++unknown.controls;
        else { owner.owned_pedals[index] = 0; --owner.owned_pedal_count; }
      } catch (...) { ++unknown.controls; }
    }
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
          NativeJrEnvelope envelope{};
          const bool timing = timing_prefix(owner, now_us(), note.execution, 0, envelope, true);
          if (observed_write(owner, {words.data(), count}, note.execution, 0, "owned-note-cleanup").is_set() || !timing) ++unknown.notes;
        } catch (...) {
          ++unknown.notes;
        }
      }
      active_notes_ -= std::min<std::uint64_t>(active_notes_, note.active);
      note.active = 0;
      if (!note.pending)
        at = owner.notes.erase(at);
      else
        ++at;
    }
    flush_egress();
    return unknown;
  }
  void retire_groups(std::uint32_t id, std::uint16_t groups, const std::string &metadata) {
    const auto found = grants_.find(id); if (found == grants_.end()) return;
    auto &owner = found->second; groups &= owner.groups; if (!groups) return; flush_ingress();
    auto affected = batches_.executions_for_groups(id, groups);
    for (unsigned address = 0; address < owner.channels.size(); ++address) if ((groups & (1u << (address / 16))) && owner.channels[address]) affected.insert(owner.channels[address]);
    if (owner.cancelled.size() + affected.size() > 4096) { retire_grant(id, "group-retirement-identity-capacity"); return; }
    owner.groups &= static_cast<std::uint16_t>(~groups);
    owner.cancelled.insert(affected.begin(), affected.end());
    cancel_batches([&](const auto &batch) { return batch.grant == id && affected.contains(batch.execution); }, "endpoint-group-layout-changed");
    CleanupCount unknown;
    for (const auto execution : affected) {
      const auto result = cleanup(owner, execution); unknown.notes += result.notes; unknown.controls += result.controls;
      for (auto &channel : owner.channels) if (channel == execution) channel = 0;
    }
    std::string executions = "[";
    for (const auto execution : affected) { if (executions.size() > 1) executions += ','; executions += std::to_string(execution); }
    executions += ']';
    emit("{\"event\":\"grant-groups-retired\",\"session\":" + std::to_string(owner.session) + ",\"grant\":" + std::to_string(id) +
         ",\"groupMask\":" + std::to_string(owner.groups) + ",\"retiredGroupMask\":" + std::to_string(groups) + ",\"originalGroupMask\":" + std::to_string(owner.original_groups) +
         ",\"executions\":" + executions + ",\"cleanupUnconfirmedNotes\":" + std::to_string(unknown.notes) + ",\"cleanupUnconfirmedControls\":" + std::to_string(unknown.controls) +
         ",\"endpointMetadata\":" + (metadata.empty() ? "null" : metadata) + ",\"reason\":\"endpoint-group-layout-changed\"}");
    if (unknown.total()) retire_grant(id, "group-cleanup-uncertain");
  }
  GrantRetirement retire_grant(std::uint32_t id,
                                              std::string_view reason) {
    const auto found = grants_.find(id);
    if (found == grants_.end())
      return {true, 0};
    if (found->second.retiring)
      return {false, found->second.cleanup_unknown, found->second.cleanup_note_unknown, found->second.cleanup_control_unknown};
    auto &owner = found->second;
    owner.retiring = true;
    if (owner.timing && owner.timing->control_grant == id && owner.timing->control_session == owner.session) { if (!owner.timing->control_confirmed) owner.timing->failed = true; owner.timing->control_execution = owner.timing->control_grant = owner.timing->control_session = 0; }
    owner.fence->live.store(false, std::memory_order_release);
    cancel_batches([&](const auto &batch) { return batch.grant == id; },
                   reason);
    const auto unknown = cleanup(owner); owner.cleanup_unknown = unknown.total(); owner.cleanup_note_unknown = unknown.notes; owner.cleanup_control_unknown = unknown.controls;
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
         ",\"cleanupUnconfirmedNotes\":" + std::to_string(unknown.notes) + ",\"cleanupUnconfirmedControls\":" + std::to_string(unknown.controls) +
         ",\"nativeCloseConfirmed\":" + (closed ? "true" : "false") + "}");
    if (closed) {
      const auto timing_key = owner.timing_key; controller_policy_count_ -= static_cast<std::uint32_t>(owner.controller_policies.size()); grants_.erase(found);
      if (timing_key && std::none_of(grants_.begin(), grants_.end(), [&](const auto &row) { return row.second.timing_key == timing_key; })) jr_states_.erase(timing_key);
    }
    return {closed, unknown.total(), unknown.notes, unknown.controls};
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
    value.groups = value.original_groups = groups;
    value.flags = flags;
    value.jr_required = endpoint && endpoint->jr_required;
    if (!input) { value.timing_key = endpoint ? endpoint->token : (1ULL << 32) | value.id; auto &timing = jr_states_[value.timing_key]; if (!timing) timing = std::make_shared<NativeJrTiming>(); value.timing = timing; }
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
                ",\"groupMask\":" + std::to_string(groups) + ",\"originalGroupMask\":" + std::to_string(groups) +
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
    const auto extension = input.take(); if (!extension.empty()) { if (extension != "leases") throw std::invalid_argument("unsupported-batch-extension"); const auto count = input.number(64); std::set<std::uint32_t> seen; for (std::size_t index = 0; index < count; ++index) { const auto id = static_cast<std::uint32_t>(input.number()); if (!id || !seen.insert(id).second) throw std::invalid_argument("invalid-controller-policy-identity"); batch.controller_policies.push_back(id); } }
    input.finish();
    auto &owner = grant(session, batch.grant);
    if (owner.jr_required && batch.priority != Priority::release) throw std::runtime_error("windows-endpoint-requires-platform-unsupported-jr");
    bool stream_configuration = false;
    if (owner.timing && owner.timing->control_execution && batch.priority != Priority::release && (owner.timing->control_session != session || owner.timing->control_grant != owner.id || owner.timing->control_execution != batch.execution)) throw std::runtime_error("endpoint-protocol-change-in-progress");
    if (owner.timing && owner.timing->failed) throw std::runtime_error("native-jr-clock-unavailable");
    for (std::size_t offset = 0; offset < batch.words.size();) {
      const auto word = batch.words[offset], type = word >> 28, utility = (word >> 20) & 15;
      stream_configuration = stream_configuration || (type == 15 && ((word >> 16) & 1023) == 5);
      if (type == 0 && (utility == 1 || utility == 2) && ((owner.timing && owner.timing->enabled) || api_ == libremidi::API::WINDOWS_MIDI_SERVICES)) throw std::invalid_argument("application-jr-words-conflict-with-native-or-os-clock-owner");
      if (type == 15 && ((word >> 16) & 1023) == 5 && api_ == libremidi::API::WINDOWS_MIDI_SERVICES) throw std::invalid_argument("windows-midi-services-owns-stream-protocol-negotiation");
      offset += ump::word_counts[type];
    }
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
    if (!batch.controller_policies.empty() && batch.priority == Priority::control) throw std::invalid_argument("manual-control-cannot-acquire-performance-cleanup");
    prepare_controller_release_actions(batch, owner.controller_policies);
    if (stream_configuration) {
      if (!owner.timing || validated.packets.size() != 1) throw std::invalid_argument("stream-configuration-must-be-isolated");
      for (const auto &[other_id, other] : grants_) if (other.timing == owner.timing && (!other.notes.empty() || other.has_owned_controls() || batches_.has_grant(other_id))) throw std::runtime_error("endpoint-has-other-owned-voices-or-queued-work");
    }
    auto channels = owner.channels;
    for (const auto &packet : validated.packets) {
      const auto words = std::span<const std::uint32_t>{batch.words}.subspan(
          packet.offset, packet.words);
      if (!permits_packet(words, owner.groups, owner.flags))
        throw std::invalid_argument("packet-outside-device-grant");
      const auto type = words[0] >> 28;
      const auto mutation = note_mutation(words);
      if (batch.priority == Priority::release && (!mutation || mutation->begin)) {
        const auto pedal = pedal_mutation(words); bool owned_reset = pedal && !pedal->active && owner.owned_pedals[pedal->index] == batch.execution;
        for (const auto &range : batch.controller_resets) if (packet.offset >= range.offset && packet.offset < range.offset + range.words) { const auto lease = owner.controller_leases.find(range.policy); owned_reset = lease != owner.controller_leases.end() && lease->second.execution == batch.execution && (lease->second.active || lease->second.pending); if (owned_reset) break; }
        if (!owned_reset) throw std::invalid_argument("release-priority-requires-owned-note-off-or-controller-reset");
      }
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
    std::vector<std::uint32_t> inserted_controllers;
    std::vector<NoteKey> inserted;
    inserted.reserve(batch.note_ons.size()); inserted_controllers.reserve(batch.controller_policies.size());
    try {
      for (const auto id : batch.controller_policies) { const auto [at, created] = owner.controller_leases.try_emplace(id, ControllerReleaseLease{batch.execution, 0, false, false}); if (created) inserted_controllers.push_back(id); else if (at->second.execution != batch.execution) throw std::runtime_error("controller-owned-by-another-execution"); }
      for (const auto &key : batch.note_ons) {
        const auto [at, created] =
            owner.notes.try_emplace(key, OwnedNote{batch.execution, 0, 0});
        if (created)
          inserted.push_back(key);
        else if (at->second.execution != batch.execution)
          throw std::runtime_error("note-owned-by-another-execution");
      }
    } catch (...) {
      for (const auto id : inserted_controllers) owner.controller_leases.erase(id);
      for (const auto &key : inserted)
        owner.notes.erase(key);
      throw;
    }
    for (const auto id : batch.controller_policies) ++owner.controller_leases.at(id).pending;
    for (const auto &key : batch.note_ons)
      ++owner.notes.at(key).pending;
    pending_note_ons_ += batch.note_ons.size();
    owner.channels = channels;
    if (stream_configuration) { owner.timing->control_session = session; owner.timing->control_grant = owner.id; owner.timing->control_execution = batch.execution; owner.timing->control_confirmed = false; owner.timing->control_deadline_us = now + 5000000; }
    batch.ordinal = ++batch_ordinal_;
    const auto id = batch.grant, execution = batch.execution;
    batches_.insert(std::move(batch));
    reply(request, session, "queued",
          "\"grant\":" + std::to_string(id) +
              ",\"execution\":" + std::to_string(execution) +
              ",\"nativeMonoUs\":" + std::to_string(now));
  }
  void account_packet(Grant &owner, std::span<const std::uint32_t> words,
                      bool uncertain = false, bool own_controls = false) {
    if (own_controls) if (const auto pedal = pedal_mutation(words)) {
      auto &lease = owner.owned_pedals[pedal->index];
      if (pedal->active || uncertain) { if (!lease) ++owner.owned_pedal_count; lease = owner.channels[pedal->channel_address]; }
      else if (lease) { lease = 0; --owner.owned_pedal_count; }
    }
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
      bool entered_driver{}, prefixed{};
      NativeJrEnvelope envelope{};
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
        if (!prefixed) {
          prefixed = true;
          if (!self.timing_prefix(owner, batch.deadline, batch.execution, batch.request, envelope)) {
            refused = "native-jr-envelope-failed-or-cancelled"; return std::errc::io_error;
          }
        }
        entered_driver = true;
        const auto result = self.observed_write(owner, {words, count}, batch.execution, batch.request, "batch-packet");
        if (!result.is_set() && !owner.fence->fault.load()) {
          self.account_controller_release(owner, batch, static_cast<std::size_t>(words - batch.words.data()), false);
          self.account_packet(owner, {words, count}, false, batch.priority != Priority::control);
        }
        if (!result.is_set() && owner.fence->fault.load())
          return std::errc::io_error;
        return result;
      }
    } sender{*this, owner, batch};
    if (batch.priority == Priority::release) for (const auto &range : batch.controller_resets) { const auto lease = owner.controller_leases.find(range.policy); if (lease == owner.controller_leases.end() || lease->second.execution != batch.execution || !lease->second.active) { release_pending(batch); error(batch.request, batch.session, "controller-reset-not-owned-at-dispatch"); return; } }
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
      account_controller_release(owner, batch, offset, true);
      account_packet(owner,
                     std::span<const std::uint32_t>{batch.words}.subspan(
                         offset, ump::word_counts[batch.words[offset] >> 28]),
                     true, batch.priority != Priority::control);
    }
    release_pending(batch);
    flush_egress();
    const auto jr = owner.timing && owner.timing->enabled ?
      std::string{",\"jrTiming\":{\"clockDomain\":\"companion-steady-microseconds\",\"tickUs\":32,\"requestedTick\":"} + std::to_string(sender.envelope.requested_tick) +
      ",\"representedTick\":" + std::to_string(sender.envelope.represented_tick) + ",\"monotonicRepair\":" + (sender.envelope.repaired ? "true" : "false") +
      ",\"envelopeWords\":" + std::to_string(sender.envelope.count) + ",\"envelopeAcceptedWords\":" + std::to_string(sender.envelope.accepted) +
      ",\"envelopeUnconfirmed\":" + (sender.envelope.failed_unconfirmed ? "true" : "false") + "}" : std::string{};
    reply(
        batch.request, batch.session,
        result.reason ? (result.accepted_packets ? "partial" : "rejected")
                      : "driver-submitted",
        "\"grant\":" + std::to_string(batch.grant) +
            ",\"nativeBatchId\":" + std::to_string(batch.request) + jr +
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
    if (result.reason && (!sender.refused || sender.envelope.failed_unconfirmed))
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
      } else if (operation == "F") {
        const auto id = static_cast<std::uint32_t>(input.number()); const auto action = input.take();
        auto &owner = grant(session, id); if (owner.input) throw std::invalid_argument("controller-policy-needs-output");
        if (action == "register") {
          const auto count = input.number(6); std::array<std::uint32_t, 6> words{};
          for (std::size_t index = 0; index < count; ++index) words[index] = static_cast<std::uint32_t>(input.number(0xffffffffu, 16)); input.finish();
          auto policy = controller_release_policy({words.data(), static_cast<std::size_t>(count)});
          for (std::size_t offset = 0; offset < count;) { const auto size = ump::word_counts[words[offset] >> 28]; if (!permits_packet({words.data() + offset, size}, owner.groups, owner.flags)) throw std::invalid_argument("controller-policy-outside-owned-group"); offset += size; }
          std::uint32_t existing{};
          for (const auto &[policy_id, previous] : owner.controller_policies) if (controller_release_overlaps(previous, policy)) {
            if (!previous.retired && previous.identity == policy.identity && previous.count == policy.count && previous.reset == policy.reset) existing = policy_id;
            else throw std::runtime_error("controller-release-policy-address-conflict");
          }
          if (!existing) {
            if (owner.controller_policies.size() >= 256 || controller_policy_count_ >= 4096 || next_controller_policy_ == 0xffffffffu) throw std::runtime_error("controller-release-policy-capacity");
            policy.id = ++next_controller_policy_; owner.controller_policies.emplace(policy.id, policy); ++controller_policy_count_; existing = policy.id;
          }
          reply(request, session, "registered-controller-policy", "\"grant\":" + std::to_string(id) + ",\"policy\":" + std::to_string(existing) + ",\"armed\":false");
        } else if (action == "retire") {
          const auto policy_id = static_cast<std::uint32_t>(input.number()); input.finish();
          const auto found = owner.controller_policies.find(policy_id); if (found == owner.controller_policies.end()) throw std::invalid_argument("controller-release-policy-not-owned");
          found->second.retired = true;
          cancel_batches([&](const auto &batch) { return batch.grant == id && std::find(batch.controller_policies.begin(), batch.controller_policies.end(), policy_id) != batch.controller_policies.end(); }, "controller-policy-retired");
          const bool unknown = cleanup_controller_release(owner, policy_id); reap_controller_release(owner, policy_id); flush_egress();
          reply(request, session, "retired-controller-policy", "\"grant\":" + std::to_string(id) + ",\"policy\":" + std::to_string(policy_id) + ",\"cleanupUnconfirmedControls\":" + (unknown ? "1" : "0"));
          if (unknown) retire_grant(id, "controller-policy-cleanup-uncertain");
        } else throw std::invalid_argument("unknown-controller-policy-operation");
      } else if (operation == "J") {
        set_jr_mode(request, session, input);
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
      } else if (operation == "G") {
        const auto inventory = input.number(); const auto id = static_cast<std::uint32_t>(input.number());
        const auto groups = static_cast<std::uint16_t>(input.number(65535)); input.finish();
        auto &owner = grant(session, id);
        if (inventory != inventory_epoch_ || owner.virtual_port || (groups & ~owner.original_groups)) throw std::invalid_argument("refresh-and-select-original-owned-group-scope");
        const auto endpoint = std::find_if(endpoints_.begin(), endpoints_.end(), [&](const auto &row) { return row.token == owner.endpoint; });
        if (endpoint == endpoints_.end() || !endpoint->groups_known || (groups & ~endpoint->groups)) throw std::runtime_error("group-scope-not-currently-advertised");
        const auto added = static_cast<std::uint16_t>(groups & ~owner.groups);
        for (const auto &[other_id, other] : grants_) if (other_id != id && other.endpoint == owner.endpoint && !owner.input && !other.input && (added & other.groups)) throw std::runtime_error("revalidated-group-owned-by-another-grant");
        owner.groups |= added;
        reply(request, session, "revalidated-groups", "\"grant\":" + std::to_string(id) + ",\"groupMask\":" + std::to_string(owner.groups) + ",\"addedGroupMask\":" + std::to_string(added) +
              ",\"originalGroupMask\":" + std::to_string(owner.original_groups) + ",\"endpointMetadata\":" + (endpoint->endpoint_metadata.empty() ? "null" : endpoint->endpoint_metadata));
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
        bool protocol_confirmed = true;
        if (owner.timing && owner.timing->control_execution == execution && owner.timing->control_grant == id && owner.timing->control_session == session) {
          protocol_confirmed = owner.timing->control_confirmed; if (!protocol_confirmed) owner.timing->failed = true;
          owner.timing->control_execution = owner.timing->control_grant = owner.timing->control_session = 0;
        }
        owner.fence->finish_cancel(execution);
        reply(request, session, "cancelled-execution",
              "\"grant\":" + std::to_string(id) +
                  ",\"execution\":" + std::to_string(execution) +
                  ",\"protocolStateConfirmed\":" + (protocol_confirmed ? "true" : "false") +
                  ",\"cleanupUnconfirmedNotes\":" + std::to_string(unknown.notes) + ",\"cleanupUnconfirmedControls\":" + std::to_string(unknown.controls));
        if (unknown.total())
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
                  std::to_string(retired.notes) + ",\"cleanupUnconfirmedControls\":" + std::to_string(retired.controls));
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
         "\",\"ciMaximumMessageBytes\":2048,\"ciMessageReportCodecVersion\":1,\"ciProfileCodecVersion\":1,\"ciPropertyCodecVersion\":1,\"umpStreamCodecVersion\":1,\"jrEncoderVersion\":1,\"ownedPedalCleanupVersion\":1,\"groupRetirementVersion\":1,\"controllerCleanupVersion\":1,"
         "\"clockDomain\":\"companion-steady-microseconds\","
         "\"nativeJrAllowed\":" + std::string(api_ == libremidi::API::WINDOWS_MIDI_SERVICES ? "false" : "true") +
         ",\"endpointDiscoveryOwner\":\"" + std::string(api_ == libremidi::API::WINDOWS_MIDI_SERVICES ? "os" : "companion") + "\"," +
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
        for (const auto &[key, timing] : jr_states_) if (timing->control_execution && now >= timing->control_deadline_us) timing->failed = true;
        std::vector<std::uint32_t> failed;
        for (const auto &[id, owner] : grants_)
          if (!owner.retiring &&
              (!owner.fence->live.load() || owner.fence->fault.load() || (owner.timing && owner.timing->failed)))
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
        jr_clocks(now_us());
        receive();
        flush_egress();
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
