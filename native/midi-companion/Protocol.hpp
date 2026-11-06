#pragma once
#include <algorithm>
#include <array>
#include <charconv>
#include <cstdint>
#include <istream>
#include <limits>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>
namespace lemmings::companion {
inline constexpr std::size_t maximum_line_bytes = 65536;
inline constexpr std::uint64_t maximum_safe_integer = 9007199254740991ULL;
struct Tokens {
  std::string_view input;
  std::string_view take() {
    while (!input.empty() && input.front() == ' ')
      input.remove_prefix(1);
    const auto end = input.find(' '),
               size = end == input.npos ? input.size() : end;
    const auto result = input.substr(0, size);
    input.remove_prefix(size);
    return result;
  }
  std::uint64_t number(std::uint64_t maximum = 0xffffffffULL, int base = 10) {
    const auto word = take();
    std::uint64_t value{};
    const auto result =
        std::from_chars(word.data(), word.data() + word.size(), value, base);
    if (word.empty() || result.ec != std::errc{} ||
        result.ptr != word.data() + word.size() || value > maximum)
      throw std::invalid_argument("invalid-integer");
    return value;
  }
  std::string hex_text(std::size_t maximum = 128) {
    const auto word = take();
    if (word.empty() || word.size() % 2 || word.size() / 2 > maximum)
      throw std::invalid_argument("invalid-text");
    std::string result;
    result.reserve(word.size() / 2);
    for (std::size_t at = 0; at < word.size(); at += 2) {
      unsigned value{};
      const auto parsed =
          std::from_chars(word.data() + at, word.data() + at + 2, value, 16);
      if (parsed.ec != std::errc{} || parsed.ptr != word.data() + at + 2 ||
          value < 32 || value == 127)
        throw std::invalid_argument("invalid-text");
      result.push_back(static_cast<char>(value));
    }
    return result;
  }
  void finish() {
    if (!take().empty())
      throw std::invalid_argument("trailing-token");
  }
};
inline std::string quote(std::string_view value, std::size_t maximum = 128) {
  auto end = std::min(value.size(), maximum);
  while (end < value.size() && end &&
         (static_cast<unsigned char>(value[end]) & 0xc0) == 0x80)
    --end;
  std::string out;
  out.reserve(end + 2);
  out.push_back('"');
  constexpr char hex[] = "0123456789abcdef";
  for (const unsigned char byte : value.substr(0, end)) {
    if (byte == '"' || byte == '\\') {
      out.push_back('\\');
      out.push_back(static_cast<char>(byte));
    } else if (byte < 32) {
      out += "\\u00";
      out.push_back(hex[byte >> 4]);
      out.push_back(hex[byte & 15]);
    } else
      out.push_back(static_cast<char>(byte));
  }
  out.push_back('"');
  return out;
}
inline std::string words_json(std::span<const std::uint32_t> words) {
  std::string out = "[";
  for (const auto word : words) {
    if (out.size() > 1)
      out.push_back(',');
    out += std::to_string(word);
  }
  out.push_back(']');
  return out;
}
inline bool read_line(std::istream &input,
                      std::array<char, maximum_line_bytes + 2> &storage,
                      std::string_view &result) {
  input.getline(storage.data(), static_cast<std::streamsize>(storage.size()));
  const auto count = input.gcount();
  if (input.eof()) {
    if (count)
      throw std::invalid_argument("unterminated-command");
    return false;
  }
  if (!input || count < 1 ||
      count > static_cast<std::streamsize>(maximum_line_bytes + 1))
    throw std::invalid_argument("command-capacity");
  result =
      std::string_view(storage.data(), static_cast<std::size_t>(count - 1));
  if (result.find('\0') != result.npos || result.find('\r') != result.npos)
    throw std::invalid_argument("invalid-command-bytes");
  return true;
}
} // namespace lemmings::companion
