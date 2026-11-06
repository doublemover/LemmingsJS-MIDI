#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <midi/utility_message.h>

namespace lemmings::companion {
struct NativeJrTiming {
  bool enabled{}, failed{}, stamp_valid{};
  std::uint64_t last_clock_us{}, last_stamp_tick{}, control_deadline_us{};
  std::uint32_t control_session{}, control_grant{}, control_execution{};
  bool control_confirmed{};
};
struct NativeJrEnvelope {
  std::array<std::uint32_t, 2> words{};
  std::size_t count{}, accepted{};
  std::uint64_t requested_tick{}, represented_tick{};
  bool repaired{}, failed_unconfirmed{};
};
inline std::uint32_t jr_clock_word(std::uint64_t now_us) {
  return midi::make_utility_message(midi::utility_status::jr_clock,
      static_cast<std::uint16_t>((now_us / 32) & 65535)).data[0];
}
inline NativeJrEnvelope jr_envelope(const NativeJrTiming &state,
                                   std::uint64_t target_us,
                                   std::uint64_t now_us) {
  NativeJrEnvelope envelope;
  if (!state.enabled) return envelope;
  envelope.requested_tick = target_us / 32;
  envelope.represented_tick = state.stamp_valid
      ? std::max(envelope.requested_tick, state.last_stamp_tick)
      : envelope.requested_tick;
  envelope.repaired = envelope.represented_tick != envelope.requested_tick;
  if (!state.last_clock_us || now_us - state.last_clock_us >= 200000)
    envelope.words[envelope.count++] = jr_clock_word(now_us);
  envelope.words[envelope.count++] = midi::make_utility_message(
      midi::utility_status::jr_timestamp,
      static_cast<std::uint16_t>(envelope.represented_tick & 65535)).data[0];
  return envelope;
}
} // namespace lemmings::companion
