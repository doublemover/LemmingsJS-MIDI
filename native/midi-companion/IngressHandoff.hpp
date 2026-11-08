#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <span>
namespace lemmings::companion {
inline constexpr std::size_t maximum_ingress_words = 4096,
                             ingress_capacity = 64;
struct IngressFence {
  std::atomic<bool> live{true}, fault{false};
  std::atomic<std::uint64_t> expires_us{0};
  std::array<std::atomic<std::uint32_t>, 16> cancelling{};
  bool cancellation_requested(std::uint32_t execution) const {
    for (const auto &entry : cancelling)
      if (entry.load(std::memory_order_acquire) == execution)
        return true;
    return false;
  }
  bool request_cancel(std::uint32_t execution) {
    for (auto &entry : cancelling) {
      std::uint32_t empty = 0;
      if (entry.load(std::memory_order_acquire) == execution ||
          entry.compare_exchange_strong(empty, execution,
                                        std::memory_order_acq_rel))
        return true;
    }
    live = false;
    return false;
  }
  void finish_cancel(std::uint32_t execution) {
    for (auto &entry : cancelling) {
      auto expected = execution;
      entry.compare_exchange_strong(expected, 0, std::memory_order_acq_rel);
    }
  }
  std::uint32_t session{}, grant{};
};
class FenceRegistry {
  std::array<std::atomic<std::shared_ptr<IngressFence>>, 64> entries_{};

public:
  bool insert(const std::shared_ptr<IngressFence> &fence) {
    for (auto &entry : entries_) {
      std::shared_ptr<IngressFence> empty;
      if (entry.compare_exchange_strong(empty, fence))
        return true;
    }
    return false;
  }
  void erase(const std::shared_ptr<IngressFence> &fence) {
    for (auto &entry : entries_) {
      auto expected = fence;
      entry.compare_exchange_strong(expected, {});
    }
  }
  void revoke(std::uint32_t session, std::uint32_t grant = 0) {
    for (auto &entry : entries_) {
      auto fence = entry.load();
      if (fence && fence->session == session &&
          (!grant || fence->grant == grant))
        fence->live = false;
    }
  }
  void cancel(std::uint32_t session, std::uint32_t grant,
              std::uint32_t execution) {
    for (auto &entry : entries_) {
      auto fence = entry.load();
      if (fence && fence->session == session && fence->grant == grant) {
        fence->request_cancel(execution);
        return;
      }
    }
  }
};
struct IngressBlock {
  std::array<std::uint32_t, maximum_ingress_words> words{};
  std::uint32_t session{}, grant{}, count{};
  std::int64_t source_timestamp_ns{};
  std::uint64_t arrival_us{}, loss_generation{};
};
class IngressHandoff {
  std::array<IngressBlock, ingress_capacity> rows_{};
  std::mutex mutex_;
  std::size_t first_{}, size_{};

public:
  std::condition_variable wake;
  std::atomic<std::uint64_t> oversized{}, contended{}, full{}, retired{},
      loss_generation{};
  bool push(const std::shared_ptr<IngressFence> &fence,
            std::span<const std::uint32_t> words, std::int64_t source_ns,
            std::uint64_t arrival_us) noexcept {
    if (!fence->live.load(std::memory_order_acquire) ||
        arrival_us >= fence->expires_us.load(std::memory_order_acquire)) {
      ++retired;
      return false;
    }
    if (words.empty() || words.size() > maximum_ingress_words) {
      ++oversized;
      ++loss_generation;
      return false;
    }
    std::unique_lock lock(mutex_, std::try_to_lock);
    if (!lock.owns_lock()) {
      ++contended;
      ++loss_generation;
      return false;
    }
    if (!fence->live.load(std::memory_order_acquire)) {
      ++retired;
      return false;
    }
    if (size_ == ingress_capacity) {
      ++full;
      ++loss_generation;
      return false;
    }
    auto &row = rows_[(first_ + size_) % ingress_capacity];
    row.session = fence->session;
    row.grant = fence->grant;
    row.count = static_cast<std::uint32_t>(words.size());
    row.source_timestamp_ns = source_ns;
    row.arrival_us = arrival_us;
    row.loss_generation = loss_generation.load();
    std::copy(words.begin(), words.end(), row.words.begin());
    ++size_;
    lock.unlock();
    wake.notify_one();
    return true;
  }
  bool pop(IngressBlock &destination) {
    std::lock_guard lock(mutex_);
    if (!size_)
      return false;
    const auto &row = rows_[first_];
    destination.session = row.session;
    destination.grant = row.grant;
    destination.count = row.count;
    destination.source_timestamp_ns = row.source_timestamp_ns;
    destination.arrival_us = row.arrival_us;
    destination.loss_generation = row.loss_generation;
    std::copy_n(row.words.begin(), row.count, destination.words.begin());
    first_ = (first_ + 1) % ingress_capacity;
    --size_;
    return true;
  }
};
} // namespace lemmings::companion
