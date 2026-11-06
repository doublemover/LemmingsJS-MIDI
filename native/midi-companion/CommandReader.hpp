#pragma once
#include "IngressHandoff.hpp"
#include "NativeIo.hpp"
#include <array>
#include <atomic>
#include <chrono>
#include <thread>
#ifdef _WIN32
#include <Windows.h>
#else
#include <poll.h>
#include <unistd.h>
#endif
namespace lemmings::companion {
inline void read_commands(NativeInput &input, IngressHandoff &handoff,
                          FenceRegistry &fences,
                          const std::atomic<bool> &stop) noexcept {
  std::array<char, 4096> bytes{};
  std::string line;
  line.reserve(maximum_line_bytes);
  try {
    while (!stop.load(std::memory_order_acquire)) {
      std::size_t count = 0;
#ifdef _WIN32
      const auto handle = GetStdHandle(STD_INPUT_HANDLE);
      DWORD ready = 0, received = 0;
      if (GetFileType(handle) == FILE_TYPE_PIPE) {
        if (!PeekNamedPipe(handle, nullptr, 0, nullptr, &ready, nullptr))
          break;
        if (!ready) {
          std::this_thread::sleep_for(std::chrono::milliseconds(2));
          continue;
        }
      } else {
        if (WaitForSingleObject(handle, 2) != WAIT_OBJECT_0)
          continue;
        ready = bytes.size();
      }
      if (!ReadFile(
              handle, bytes.data(),
              static_cast<DWORD>(std::min<std::size_t>(ready, bytes.size())),
              &received, nullptr) ||
          !received)
        break;
      count = received;
#else
      pollfd descriptor{STDIN_FILENO, POLLIN, 0};
      const auto status = poll(&descriptor, 1, 2);
      if (status < 0)
        break;
      if (!status)
        continue;
      const auto received = read(STDIN_FILENO, bytes.data(), bytes.size());
      if (received <= 0)
        break;
      count = static_cast<std::size_t>(received);
#endif
      for (std::size_t index = 0; index < count; ++index) {
        const auto byte = bytes[index];
        if (byte == '\0' || byte == '\r' || line.size() >= maximum_line_bytes)
          throw std::invalid_argument("command-capacity-or-invalid-bytes");
        if (byte != '\n') {
          line.push_back(byte);
          continue;
        }
        Tokens tokens{line};
        const auto operation = tokens.take();
        try {
          const auto request = tokens.number();
          const auto session = static_cast<std::uint32_t>(tokens.number());
          (void)request;
          if (operation == "C") {
            const auto grant = static_cast<std::uint32_t>(tokens.number()),
                       execution = static_cast<std::uint32_t>(tokens.number());
            tokens.finish();
            if (execution)
              fences.cancel(session, grant, execution);
          } else if (operation == "X") {
            const auto grant = static_cast<std::uint32_t>(tokens.number());
            tokens.finish();
            fences.revoke(session, grant);
          } else if (operation == "D") {
            tokens.finish();
            fences.revoke(session);
          }
        } catch (...) {
        }
        if (!input.push(line))
          throw std::runtime_error("command-queue-capacity");
        line.clear();
        handoff.wake.notify_one();
      }
    }
  } catch (...) {
    input.pressure = true;
  }
  input.ended = true;
  handoff.wake.notify_one();
}
} // namespace lemmings::companion
