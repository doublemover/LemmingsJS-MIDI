#pragma once
#include "../midi-codec/UmpBatchGuard.hpp"
#include <algorithm>
#include <array>
#include <cstdint>
#include <map>
#include <optional>
#include <span>
#include <tuple>
#include <vector>
namespace lemmings::companion {
enum Permission : std::uint32_t {
  sysex = 1,
  timing = 2,
  sensing = 4,
  endpoint_control = 8
};
enum class Priority : std::uint32_t {
  release = 0,
  performance = 1,
  control = 2
};
struct NoteKey {
  std::uint8_t protocol{}, group{}, channel{}, note{};
  auto operator<=>(const NoteKey &) const = default;
};
struct NoteMutation {
  NoteKey key;
  bool begin{};
};
inline std::optional<NoteMutation>
note_mutation(std::span<const std::uint32_t> words) {
  if (words.empty())
    return {};
  const auto first = words[0], type = first >> 28, status = (first >> 20) & 15;
  if ((type != 2 && type != 4) || (status != 8 && status != 9))
    return {};
  return NoteMutation{{static_cast<std::uint8_t>(type),
                       static_cast<std::uint8_t>((first >> 24) & 15),
                       static_cast<std::uint8_t>((first >> 16) & 15),
                       static_cast<std::uint8_t>((first >> 8) & 127)},
                      status == 9 && !(type == 2 && (first & 127) == 0)};
}
inline bool permits_packet(std::span<const std::uint32_t> words,
                           std::uint16_t groups, std::uint32_t flags) {
  if (words.empty())
    return false;
  const auto first = words[0], type = first >> 28, status = (first >> 20) & 15;
  if (type == 0 || type == 15)
    return (flags & endpoint_control) != 0;
  if (!(groups & (1u << ((first >> 24) & 15))))
    return false;
  if (type == 3 || (type == 5 && status <= 3))
    return (flags & sysex) != 0;
  if (type == 1) {
    const auto code = (first >> 16) & 255;
    if (code == 0xfe)
      return (flags & sensing) != 0;
    if (code >= 0xf8 && code <= 0xfc)
      return (flags & timing) != 0;
  }
  return true;
}
struct PendingBatch {
  std::uint32_t request{}, session{}, grant{}, execution{};
  std::uint64_t deadline{}, ordinal{};
  Priority priority = Priority::performance;
  std::vector<std::uint32_t> words;
  std::vector<NoteKey> note_ons;
};
class BatchQueue {
  std::vector<PendingBatch> queue_;
  std::size_t words_{};
  static bool before(const PendingBatch &left, const PendingBatch &right) {
    return std::tie(left.deadline, left.priority, left.ordinal) <
           std::tie(right.deadline, right.priority, right.ordinal);
  }

public:
  static constexpr std::size_t maximum_batches = 128, maximum_words = 65536,
                               release_word_reserve = 4096,
                               release_batch_reserve = 8;
  BatchQueue() { queue_.reserve(maximum_batches); }
  const char *can_admit(const PendingBatch &batch) const {
    if (queue_.size() >= (batch.priority == Priority::release
                              ? maximum_batches
                              : maximum_batches - release_batch_reserve) ||
        words_ + batch.words.size() >
            (batch.priority == Priority::release
                 ? maximum_words
                 : maximum_words - release_word_reserve))
      return "native-queue-capacity";
    std::size_t session = 0, grant = 0, control = 0;
    for (const auto &queued : queue_) {
      session += queued.session == batch.session;
      grant += queued.grant == batch.grant;
      control +=
          queued.grant == batch.grant && queued.priority == Priority::control;
    }
    if (session >= (batch.priority == Priority::release ? 64u : 56u) ||
        grant >= (batch.priority == Priority::release ? 32u : 28u) ||
        (batch.priority == Priority::control && control >= 8))
      return "native-endpoint-queue-capacity";
    return nullptr;
  }
  void insert(PendingBatch batch) {
    words_ += batch.words.size();
    const auto at =
        std::upper_bound(queue_.begin(), queue_.end(), batch, before);
    queue_.insert(at, std::move(batch));
  }
  std::optional<PendingBatch> due(std::uint64_t now) {
    if (queue_.empty() || queue_.front().deadline > now)
      return {};
    PendingBatch batch = std::move(queue_.front());
    words_ -= batch.words.size();
    queue_.erase(queue_.begin());
    return batch;
  }
  template <class Predicate>
  std::vector<PendingBatch> cancel(Predicate predicate) {
    std::vector<PendingBatch> removed;
    for (auto iterator = queue_.begin(); iterator != queue_.end();)
      if (predicate(*iterator)) {
        words_ -= iterator->words.size();
        removed.push_back(std::move(*iterator));
        iterator = queue_.erase(iterator);
      } else
        ++iterator;
    return removed;
  }
  std::uint64_t next_deadline(std::uint64_t fallback) const {
    return queue_.empty() ? fallback
                          : std::min(fallback, queue_.front().deadline);
  }
  bool has_grant(std::uint32_t id) const { return std::any_of(queue_.begin(), queue_.end(), [&](const auto &batch) { return batch.grant == id; }); }
  std::size_t pending_words() const { return words_; }
  std::size_t pending_batches() const { return queue_.size(); }
};
struct OwnedNote {
  std::uint32_t execution{}, pending{}, active{};
};
inline std::array<std::uint32_t, 2> note_off(const NoteKey &key) {
  return {(static_cast<std::uint32_t>(key.protocol) << 28) |
              (static_cast<std::uint32_t>(key.group) << 24) | (8u << 20) |
              (static_cast<std::uint32_t>(key.channel) << 16) |
              (static_cast<std::uint32_t>(key.note) << 8),
          key.protocol == 4 ? 0x80000000u : 0u};
}
} // namespace lemmings::companion
