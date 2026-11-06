#pragma once
#include "Protocol.hpp"
#include <atomic>
#include <condition_variable>
#include <deque>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
namespace lemmings::companion {
class NativeOutput {
  std::mutex mutex_;
  std::condition_variable wake_;
  std::deque<std::string> lines_;
  std::size_t bytes_{};
  bool closing_{};
  std::thread thread_;
  void run() {
    for (;;) {
      std::string line;
      {
        std::unique_lock lock(mutex_);
        wake_.wait(lock, [&] { return closing_ || !lines_.empty(); });
        if (lines_.empty())
          return;
        line = std::move(lines_.front());
        lines_.pop_front();
        bytes_ -= line.size();
      }
      std::cout.write(line.data(), static_cast<std::streamsize>(line.size()));
      std::cout.put('\n');
      std::cout.flush();
      if (!std::cout) {
        pressure = true;
        return;
      }
    }
  }

public:
  std::atomic<bool> pressure{false};
  std::atomic<std::uint64_t> dropped_ingress{0};
  NativeOutput() {
    thread_ = std::thread([this] { run(); });
  }
  bool push(std::string line, bool critical = true) {
    std::lock_guard lock(mutex_);
    if (closing_ || line.size() > maximum_line_bytes || lines_.size() >= 512 ||
        bytes_ + line.size() > 1048576) {
      if (critical)
        pressure = true;
      else
        ++dropped_ingress;
      return false;
    }
    bytes_ += line.size();
    lines_.push_back(std::move(line));
    wake_.notify_one();
    return true;
  }
  void close() {
    {
      std::lock_guard lock(mutex_);
      closing_ = true;
    }
    wake_.notify_one();
    if (thread_.joinable())
      thread_.join();
  }
  ~NativeOutput() { close(); }
};
class NativeInput {
  std::mutex mutex_;
  std::deque<std::string> priority_, regular_;
  std::size_t bytes_{};

public:
  std::atomic<bool> ended{false}, pressure{false};
  bool push(std::string_view line) {
    Tokens input{line};
    const auto operation = input.take();
    const bool priority = operation == "C" || operation == "X" ||
                          operation == "D" || operation == "H" ||
                          operation == "Q";
    std::lock_guard lock(mutex_);
    if (priority_.size() + regular_.size() >= (priority ? 144u : 128u) ||
        bytes_ + line.size() > (priority ? 1048576u : 1032192u)) {
      if (priority)
        pressure = true;
      return false;
    }
    bytes_ += line.size();
    (priority ? priority_ : regular_).emplace_back(line);
    return true;
  }
  bool pop(std::string &line) {
    std::lock_guard lock(mutex_);
    auto &queue = priority_.empty() ? regular_ : priority_;
    if (queue.empty())
      return false;
    line = std::move(queue.front());
    queue.pop_front();
    bytes_ -= line.size();
    return true;
  }
};
} // namespace lemmings::companion
