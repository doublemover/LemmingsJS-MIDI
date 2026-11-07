#pragma once
#include "NativeBatch.hpp"
#include <array>
#include <cstdint>
#include <map>
#include <span>
#include <stdexcept>
#include <vector>

namespace lemmings::companion {
struct ControllerReleasePolicy {
  std::uint32_t id{}, identity{};
  std::array<std::uint32_t, 6> reset{};
  std::uint8_t count{}, trigger{}, terminal{};
  bool selectors{}, retired{};
};
struct ControllerReleaseLease {
  std::uint32_t execution{}, pending{};
  bool active{}, selector_dirty{};
};
inline ControllerReleasePolicy controller_release_policy(std::span<const std::uint32_t> words) {
  if (words.empty() || words.size() > 6 || ump::validate_batch(words).error.code) throw std::invalid_argument("invalid-controller-release-packet");
  ControllerReleasePolicy result;
  result.count = static_cast<std::uint8_t>(words.size());
  std::copy(words.begin(), words.end(), result.reset.begin());
  const auto first = words[0], protocol = first >> 28, group = (first >> 24) & 15, channel = (first >> 16) & 15;
  const auto status = (first >> 20) & 15, index = (first >> 8) & 127;
  std::uint32_t kind{}, parameter{};
  if (protocol == 4 && words.size() == 2 && (status == 11 || status == 2 || status == 3)) {
    kind = status == 11 ? 0 : status == 2 ? 1 : 2; parameter = kind ? ((first >> 8) & 127) * 128 + (first & 127) : index;
    result.terminal = result.trigger = 0;
  } else if (protocol == 2 && status == 11) {
    const auto control = [&](std::size_t at, unsigned controller) { return at < words.size() && (words[at] & 0xffffff80u) == ((first & 0xffff0000u) | (controller << 8)); };
    if (words.size() == 1) { parameter = index; }
    else if (words.size() == 2 && index < 32 && control(1, index + 32)) { kind = 3; parameter = index; result.terminal = 1; }
    else if (words.size() == 6 && (index == 101 || index == 99) && control(1, index - 1) && control(2, 6) && control(3, 38) && control(4, index) && control(5, index - 1) && (words[4] & 127) == 127 && (words[5] & 127) == 127) {
      kind = index == 101 ? 1 : 2; parameter = (first & 127) * 128 + (words[1] & 127); result.trigger = 2; result.terminal = 5; result.selectors = true;
    } else throw std::invalid_argument("controller-release-requires-complete-typed-transaction");
  } else throw std::invalid_argument("controller-release-form-unsupported");
  if (kind == 0 || kind == 3) {
    if (parameter == 0 || parameter == 32 || parameter == 6 || parameter == 38 || (parameter >= 96 && parameter <= 101) || parameter >= 120 ||
        parameter == 64 || parameter == 66 || parameter == 67) throw std::invalid_argument("controller-release-address-reserved-or-pedal-owned");
  } else if (kind == 1 && parameter == 6) throw std::invalid_argument("legacy-mpe-configuration-is-not-a-performance-control");
  result.identity = protocol << 28 | group << 24 | channel << 20 | kind << 16 | parameter;
  return result;
}
inline bool controller_release_overlaps(const ControllerReleasePolicy &left, const ControllerReleasePolicy &right) {
  if ((left.identity & 0xfff00000u) != (right.identity & 0xfff00000u)) return false;
  if (left.identity == right.identity) return true;
  const auto left_kind = (left.identity >> 16) & 15, right_kind = (right.identity >> 16) & 15;
  if ((left_kind != 0 && left_kind != 3) || (right_kind != 0 && right_kind != 3)) return false;
  const auto a = left.identity & 65535, b = right.identity & 65535;
  return a == b || (left_kind == 3 && a + 32 == b) || (right_kind == 3 && b + 32 == a);
}
inline bool release_transaction_matches(const ControllerReleasePolicy &policy, std::span<const std::uint32_t> words) {
  if (words.size() != policy.count) return false;
  const auto protocol = policy.identity >> 28, kind = (policy.identity >> 16) & 15;
  if (protocol == 4) return words[0] == policy.reset[0];
  for (std::size_t index = 0; index < words.size(); ++index) {
    const bool data = kind == 1 || kind == 2 ? index == 2 || index == 3 : true;
    if (data ? (words[index] & 0xffffff80u) != (policy.reset[index] & 0xffffff80u) : words[index] != policy.reset[index]) return false;
  }
  return true;
}
inline void prepare_controller_release_actions(PendingBatch &batch, const std::map<std::uint32_t, ControllerReleasePolicy> &policies) {
  if (!batch.controller_policies.empty()) batch.controller_actions.reserve(batch.words.size() * 2);
  for (const auto id : batch.controller_policies) {
    const auto found = policies.find(id); if (found == policies.end() || found->second.retired) throw std::invalid_argument("controller-release-policy-stale");
    const auto &policy = found->second; bool matched = false;
    for (std::size_t offset = 0; offset < batch.words.size();) {
      const auto width = ump::word_counts[batch.words[offset] >> 28];
      if (batch.words.size() - offset >= policy.count && release_transaction_matches(policy, std::span<const std::uint32_t>{batch.words}.subspan(offset, policy.count))) {
        matched = true; const bool reset = std::equal(policy.reset.begin(), policy.reset.begin() + policy.count, batch.words.begin() + offset);
        if (reset) batch.controller_resets.push_back({offset, policy.count, id});
        if (policy.selectors) batch.controller_actions.push_back({offset, id, false, false, true, false});
        const auto packet_width = (policy.identity >> 28) == 4 ? 2u : 1u;
        batch.controller_actions.push_back({offset + policy.trigger * packet_width, id, true, false, false, false});
        batch.controller_actions.push_back({offset + policy.terminal * packet_width, id, false, reset, false, policy.selectors});
        offset += policy.count;
      } else offset += width;
    }
    if (!matched) throw std::invalid_argument("controller-release-policy-has-no-matching-write");
  }
  std::stable_sort(batch.controller_actions.begin(), batch.controller_actions.end(), [](const auto &left, const auto &right) { return left.offset < right.offset; });
}
}
