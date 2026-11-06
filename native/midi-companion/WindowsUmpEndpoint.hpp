#pragma once
#include "IngressHandoff.hpp"
#if defined(LIBREMIDI_WINMIDI)
#include <functional>
#include <libremidi/backends/winmidi/helpers.hpp>
#include <libremidi/libremidi.hpp>
#include <limits>
#include <string>
#include <vector>
namespace lemmings::companion {
namespace win_midi = winrt::Microsoft::Windows::Devices::Midi2;
struct WindowsEndpointInfo {
  std::string device, name, manufacturer, transport;
  std::uint16_t input_groups{}, output_groups{};
};
inline std::vector<WindowsEndpointInfo> windows_endpoints() {
  std::vector<WindowsEndpointInfo> result;
  for (const auto &endpoint :
       win_midi::MidiEndpointDeviceInformation::FindAll()) {
    if (result.size() >= 512)
      throw std::runtime_error("windows-endpoint-inventory-capacity");
    const auto supplied = endpoint.GetTransportSuppliedInfo();
    WindowsEndpointInfo info{winrt::to_string(endpoint.EndpointDeviceId()),
                             winrt::to_string(endpoint.Name()),
                             winrt::to_string(supplied.ManufacturerName),
                             winrt::to_string(supplied.TransportCode)};
    const auto collect = [&](const auto &block) {
      using Direction = decltype(block.Direction());
      const auto first = static_cast<unsigned>(block.FirstGroup().Index()),
                 count = static_cast<unsigned>(block.GroupCount());
      if (first > 15 || !count || first + count > 16)
        return;
      const auto mask =
          static_cast<std::uint16_t>(((1u << count) - 1u) << first);
      const auto direction = block.Direction();
      if (direction == Direction::BlockInput ||
          direction == Direction::Bidirectional)
        info.output_groups |= mask;
      if (direction == Direction::BlockOutput ||
          direction == Direction::Bidirectional)
        info.input_groups |= mask;
    };
    for (const auto &block : endpoint.GetDeclaredFunctionBlocks())
      collect(block);
    for (const auto &block : endpoint.GetGroupTerminalBlocks())
      collect(block);
    result.push_back(std::move(info));
  }
  return result;
}
class WindowsUmpEndpoint {
  libremidi::winmidi::winmidi_shared_data bootstrap_;
  win_midi::MidiSession session_{nullptr};
  win_midi::MidiEndpointConnection connection_{nullptr};
#if LIBREMIDI_WINMIDI_HAS_VIRTUAL_DEVICE
  winrt::Microsoft::Windows::Devices::Midi2::Endpoints::Virtual::
      MidiVirtualDevice virtual_{nullptr};
#endif
  winrt::event_token subscription_{};
  bool subscribed_{}, connection_created_{}, virtual_live_{};
  std::shared_ptr<IngressFence> fence_;
  std::shared_ptr<IngressHandoff> handoff_;
  std::function<std::uint64_t()> now_;
  void subscribe() {
    const auto frequency = win_midi::MidiClock::TimestampFrequency();
    auto fence = fence_;
    auto handoff = handoff_;
    auto now = now_;
    subscription_ = connection_.MessageReceived(
        [fence, handoff, now, frequency](
            const auto &, const win_midi::MidiMessageReceivedEventArgs &args) {
          if (!fence->live.load(std::memory_order_acquire))
            return;
          try {
            const auto packet = args.GetMessagePacket();
            const auto words = packet.GetAllWords();
            const auto count = words.Size();
            if (!count || count > 4) {
              ++handoff->oversized;
              return;
            }
            std::array<std::uint32_t, 4> storage{};
            winrt::array_view<std::uint32_t> view{storage.data(),
                                                  storage.data() + count};
            if (words.GetMany(0, view) != count) {
              fence->fault = true;
              return;
            }
            std::int64_t nanoseconds{};
            if (frequency &&
                frequency <=
                    std::numeric_limits<std::uint64_t>::max() / 1000000000ULL) {
              const auto ticks = packet.Timestamp();
              const auto whole = ticks / frequency,
                         remainder = ticks % frequency;
              if (whole <= static_cast<std::uint64_t>(
                               std::numeric_limits<std::int64_t>::max()) /
                               1000000000ULL)
                nanoseconds = static_cast<std::int64_t>(
                    whole * 1000000000ULL +
                    remainder * 1000000000ULL / frequency);
            }
            handoff->push(fence,
                          std::span<const std::uint32_t>{storage.data(), count},
                          nanoseconds, now());
          } catch (...) {
            fence->fault = true;
            handoff->wake.notify_one();
          }
        });
    subscribed_ = true;
  }

public:
  WindowsUmpEndpoint(std::shared_ptr<IngressFence> fence,
                     std::shared_ptr<IngressHandoff> handoff,
                     std::function<std::uint64_t()> now)
      : fence_{std::move(fence)}, handoff_{std::move(handoff)},
        now_{std::move(now)} {
    if (!bootstrap_.self->ready)
      throw std::runtime_error("windows-midi-service-unavailable");
    session_ = win_midi::MidiSession::Create(L"LemmingsJS MIDI companion");
    if (!session_)
      throw std::runtime_error("windows-session-unavailable");
  }
  void open(std::string_view device, bool input, std::uint16_t groups) {
    const auto endpoints = windows_endpoints();
    const auto found = std::find_if(
        endpoints.begin(), endpoints.end(),
        [&](const auto &endpoint) { return endpoint.device == device; });
    if (found == endpoints.end() ||
        (groups & ~(input ? found->input_groups : found->output_groups)))
      throw std::invalid_argument("windows-native-group-span-changed");
    connection_ = session_.CreateEndpointConnection(winrt::to_hstring(device));
    if (!connection_)
      throw std::runtime_error("windows-endpoint-unavailable");
    connection_created_ = true;
    if (input)
      subscribe();
    if (!connection_.Open())
      throw std::runtime_error("windows-endpoint-open-refused");
  }
  void open_virtual(std::string_view name, bool input, std::uint16_t groups) {
#if LIBREMIDI_WINMIDI_HAS_VIRTUAL_DEVICE
    auto configuration = libremidi::winmidi::setup_virtualdevice_config(
        "LemmingsJS-MIDI", name, name,
        input ? win_midi::MidiFunctionBlockDirection::BlockInput
              : win_midi::MidiFunctionBlockDirection::BlockOutput);
    configuration.FunctionBlocks().Clear();
    std::uint8_t number = 0;
    for (unsigned group = 0; group < 16;) {
      if (!(groups & (1u << group))) {
        ++group;
        continue;
      }
      const auto first = group;
      while (group < 16 && (groups & (1u << group)))
        ++group;
      win_midi::MidiFunctionBlock block;
      block.Number(number++);
      block.IsActive(true);
      block.Name(winrt::to_hstring(name));
      block.FirstGroup(win_midi::MidiGroup(static_cast<std::uint8_t>(first)));
      block.GroupCount(static_cast<std::uint8_t>(group - first));
      block.Direction(input
                          ? win_midi::MidiFunctionBlockDirection::BlockInput
                          : win_midi::MidiFunctionBlockDirection::BlockOutput);
      configuration.FunctionBlocks().Append(block);
    }
    virtual_ = winrt::Microsoft::Windows::Devices::Midi2::Endpoints::Virtual::
        MidiVirtualDeviceManager::CreateVirtualDevice(configuration);
    if (!virtual_)
      throw std::runtime_error("windows-virtual-endpoint-unavailable");
    virtual_live_ = true;
    connection_ =
        session_.CreateEndpointConnection(virtual_.DeviceEndpointDeviceId());
    if (!connection_)
      throw std::runtime_error("windows-virtual-connection-unavailable");
    connection_created_ = true;
    connection_.AddMessageProcessingPlugin(virtual_);
    if (input)
      subscribe();
    if (!connection_.Open())
      throw std::runtime_error("windows-virtual-open-refused");
#else
    (void)name;
    (void)input;
    (void)groups;
    throw std::runtime_error("windows-virtual-sdk-unavailable");
#endif
  }
  stdx::error send_ump(const std::uint32_t *words, std::size_t count) {
    if (!connection_)
      return std::errc::not_connected;
    win_midi::MidiSendMessageResults result{};
    switch (count) {
    case 1:
      result = connection_.SendSingleMessageWords(0, words[0]);
      break;
    case 2:
      result = connection_.SendSingleMessageWords(0, words[0], words[1]);
      break;
    case 3:
      result =
          connection_.SendSingleMessageWords(0, words[0], words[1], words[2]);
      break;
    case 4:
      result = connection_.SendSingleMessageWords(0, words[0], words[1],
                                                  words[2], words[3]);
      break;
    default:
      return std::errc::bad_message;
    }
    return win_midi::MidiEndpointConnection::SendMessageSucceeded(result)
               ? stdx::error{}
               : stdx::error{std::errc::io_error};
  }
  bool close() noexcept {
    fence_->live.store(false, std::memory_order_release);
    bool complete = true;
    if (subscribed_)
      try {
        connection_.MessageReceived(subscription_);
        subscribed_ = false;
      } catch (...) {
        complete = false;
      }
    if (connection_created_)
      try {
        session_.DisconnectEndpointConnection(connection_.ConnectionId());
        connection_created_ = false;
      } catch (...) {
        complete = false;
      }
#if LIBREMIDI_WINMIDI_HAS_VIRTUAL_DEVICE
    if (virtual_live_)
      try {
        virtual_.Cleanup();
        virtual_live_ = false;
        virtual_ = nullptr;
      } catch (...) {
        complete = false;
      }
#endif
    if (complete) {
      connection_ = nullptr;
      session_ = nullptr;
    }
    return complete;
  }
  ~WindowsUmpEndpoint() { close(); }
};
} // namespace lemmings::companion
#endif
