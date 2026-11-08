#pragma once
#include <array>
#include <cstdint>
#include <optional>
#include <span>
namespace lemmings::companion {
struct PedalMutation {
  std::size_t index{}, channel_address{};
  bool active{};
};
inline std::optional<PedalMutation> pedal_mutation(std::span<const std::uint32_t> words) {
  if (words.empty()) return {};
  const auto first = words[0], type = first >> 28;
  if ((type != 2 && type != 4) || ((first >> 20) & 15) != 11) return {};
  const auto controller = (first >> 8) & 127;
  if (controller != 64 && controller != 66 && controller != 67) return {};
  const auto address = ((first >> 24) & 15) * 16 + ((first >> 16) & 15);
  const auto slot = controller == 64 ? 0u : controller == 66 ? 1u : 2u;
  return PedalMutation{(type == 4 ? 768u : 0u) + address * 3 + slot, address,
    type == 4 ? words.size() == 2 && words[1] != 0 : (first & 127) != 0};
}
inline std::array<std::uint32_t, 2> pedal_release(std::size_t index) {
  const auto protocol = index >= 768 ? 4u : 2u; const auto address = (index % 768) / 3;
  const auto slot = index % 3; const auto controller = slot == 0 ? 64u : slot == 1 ? 66u : 67u;
  return {(protocol << 28) | (static_cast<std::uint32_t>(address / 16) << 24) |
    (11u << 20) | (static_cast<std::uint32_t>(address % 16) << 16) | (controller << 8), 0};
}
struct CleanupCount {
  std::uint64_t notes{}, controls{};
  std::uint64_t total() const { return notes + controls; }
};
struct GrantRetirement {
  bool first{};
  std::uint64_t second{}, notes{}, controls{};
};
} // namespace lemmings::companion
