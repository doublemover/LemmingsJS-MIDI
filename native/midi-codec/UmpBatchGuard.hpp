#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace lemmings::ump {
inline constexpr std::array<std::size_t, 16> word_counts{1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4};
inline constexpr std::size_t maximum_words = 4096;
struct Error { const char* code = nullptr; std::size_t word_offset = 0; };
struct Packet { std::size_t offset; std::size_t words; };
struct Batch { std::vector<Packet> packets; Error error; };

inline const char* validate_packet(std::span<const std::uint32_t> words) {
  if (words.empty() || words.size() != word_counts[words[0] >> 28]) return "packet-length";
  const auto first = words[0], type = first >> 28, group = (first >> 24) & 15;
  const auto opcode = (first >> 20) & 15, channel = (first >> 16) & 15;
  const auto index = (first >> 8) & 255, detail = first & 255;
  const auto second = words.size() > 1 ? words[1] : 0;
  if (type == 0) {
    if (group || (opcode != 4 && (first & 0xf0000)) || (opcode == 0 && (first & 0xfffff))) return "reserved-bits";
    if (opcode > 4) return "unsupported-packet";
  } else if (type == 1) {
    const auto status = (first >> 16) & 255;
    unsigned size = 0;
    switch (status) {
      case 0xf1: case 0xf3: size = 1; break;
      case 0xf2: size = 2; break;
      case 0xf6: case 0xf8: case 0xfa: case 0xfb: case 0xfc: case 0xfe: case 0xff: break;
      default: return "unsupported-packet";
    }
    if (index > 127 || detail > 127 || (size < 2 && detail) || (!size && index)) return "reserved-bits";
  } else if (type == 2) {
    if (opcode < 8 || opcode > 14) return "unsupported-packet";
    if (index > 127 || detail > 127 || ((opcode == 12 || opcode == 13) && detail)) return "reserved-bits";
  } else if (type == 4) {
    if (opcode == 7) return "unsupported-packet";
    if (opcode <= 1) { if (index > 127) return "invalid-field"; }
    else if (opcode <= 5) { if (index > 127 || detail > 127) return "invalid-field"; }
    else if (opcode == 8 || opcode == 9) {
      if (index > 127 || (!detail && (second & 65535))) return "reserved-bits";
    } else if (opcode == 12) {
      if (index || (detail & 254) || (second & 0xff0000) || (second >> 24) > 127 || ((second >> 8) & 255) > 127 || (second & 255) > 127 || (!(detail & 1) && (second & 65535))) return "reserved-bits";
    } else if (opcode == 15) {
      if (index > 127 || (detail & 252) || second) return "reserved-bits";
    } else if (detail || ((opcode == 13 || opcode == 14) ? index != 0 : index > 127)) return "reserved-bits";
  } else if (type == 3 || (type == 5 && opcode <= 3)) {
    if (opcode > 3) return "unsupported-packet";
    const bool sysex8 = type == 5;
    const auto count = (first >> 16) & 15;
    if (sysex8 ? count < 1 || count > 14 : count > 6) return "sysex-length";
    const auto start = sysex8 ? 3u : 2u, length = sysex8 ? count - 1 : count;
    for (std::size_t at = start; at < words.size() * 4; ++at) {
      const auto byte = (words[at / 4] >> ((3 - at % 4) * 8)) & 255;
      if (at >= start + length ? byte != 0 : !sysex8 && byte > 127) return "reserved-padding";
    }
  } else if (type == 5) {
    if (opcode != 8 && opcode != 9) return "unsupported-packet";
  } else if (type == 13) {
    const auto format = (first >> 22) & 3, address = (first >> 20) & 3;
    if (address > 1 || (address == 1 && channel)) return "flex-address";
    if (index == 0) {
      if (format) return "flex-format";
      if (detail != 0 && detail != 1 && detail != 2 && detail != 5 && detail != 6) return "unsupported-packet";
      if (detail == 0 && !second) return "tempo-zero";
      if ((detail <= 1 && (words[2] || words[3])) || (detail == 1 && (second & 255))) return "reserved-bits";
    } else if (index == 1 ? detail > 12 : index != 2 || detail > 4) return "unsupported-packet";
  } else if (type == 15) {
    const auto format = (first >> 26) & 3, status = (first >> 16) & 1023;
    const bool text = status == 3 || status == 4 || status == 18;
    const bool known = status <= 6 || status == 16 || status == 17 || status == 18 || status == 32 || status == 33;
    if (!known) return "unsupported-packet";
    if (!text && format) return "stream-format";
    if ((status == 32 || status == 33) && ((first & 65535) || second || words[2] || words[3])) return "reserved-bits";
    if (status == 0 && ((second & 0xffffffe0) || words[2] || words[3])) return "reserved-bits";
  } else return "unsupported-packet";
  return nullptr;
}

inline Batch validate_batch(std::span<const std::uint32_t> words) {
  Batch result;
  if (words.empty() || words.size() > maximum_words) { result.error.code = "word-capacity"; return result; }
  result.packets.reserve(words.size());
  for (std::size_t at = 0; at < words.size();) {
    const auto count = word_counts[words[at] >> 28];
    const char* failure = at + count > words.size() ? "truncated-packet" : validate_packet(words.subspan(at, count));
    if (failure) { result.packets.clear(); result.error = {failure, at}; return result; }
    result.packets.push_back({at, count}); at += count;
  }
  return result;
}

template<class Sender>
concept RawSender = requires(Sender& sender, const std::uint32_t* words, std::size_t count) { bool(sender.send_ump(words, count).is_set()); };

struct Submission {
  std::size_t attempted_packets = 0, accepted_packets = 0, accepted_words = 0;
  std::size_t failure_word_offset = 0;
  const char* reason = nullptr;
  bool failed_packet_unconfirmed = false;
};

// Validate the complete batch before entering any sender callback. A later
// callback failure preserves its reported prefix and leaves that packet unknown.
// The synchronous raw sender must consume or copy each packet before returning.
template<RawSender Sender>
inline Submission dispatch(std::span<const std::uint32_t> input, Sender& sender) {
  Submission result;
  if (input.empty() || input.size() > maximum_words) { result.reason = "word-capacity"; return result; }
  const std::vector<std::uint32_t> words(input.begin(), input.end());
  const auto batch = validate_batch(words);
  if (batch.error.code) { result.reason = batch.error.code; result.failure_word_offset = batch.error.word_offset; return result; }
  for (const auto& packet : batch.packets) {
    ++result.attempted_packets;
    result.failure_word_offset = packet.offset;
    try {
      if (sender.send_ump(words.data() + packet.offset, packet.words).is_set()) {
        result.reason = "sender-rejected"; result.failed_packet_unconfirmed = true; break;
      }
    } catch (...) { result.reason = "sender-threw"; result.failed_packet_unconfirmed = true; break; }
    ++result.accepted_packets; result.accepted_words += packet.words;
  }
  return result;
}
}
