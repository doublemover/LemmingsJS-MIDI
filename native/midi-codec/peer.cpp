#include "UmpBatchGuard.hpp"
#include <cmidi2.h>
#include <libremidi/libremidi.hpp>
#include <midi/channel_voice_message.h>
#include <array>
#include <bit>
#include <charconv>
#include <iostream>
#include <stdexcept>
#include <string_view>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
constexpr std::size_t maximum_line_bytes = 65536;
static_assert(lemmings::ump::RawSender<libremidi::midi_out>);

struct Tokens {
  std::string_view text;
  std::string_view take() {
    while (!text.empty() && text.front() == ' ') text.remove_prefix(1);
    const auto end = text.find(' '), count = end == text.npos ? text.size() : end;
    const auto token = text.substr(0, count); text.remove_prefix(count);
    return token;
  }
  std::uint32_t number(std::uint32_t maximum = 0xffffffffu, int base = 10) {
    const auto token = take(); std::uint32_t value = 0;
    const auto result = std::from_chars(token.data(), token.data() + token.size(), value, base);
    if (token.empty() || result.ec != std::errc{} || result.ptr != token.data() + token.size() || value > maximum) throw std::invalid_argument("integer");
    return value;
  }
  void finish() { if (!take().empty()) throw std::invalid_argument("trailing-token"); }
};

void words_json(std::span<const std::uint32_t> words) {
  std::cout << '['; bool first = true;
  for (const auto word : words) { if (!first) std::cout << ','; std::cout << word; first = false; }
  std::cout << ']';
}

void wire_hex(std::span<const std::uint32_t> words) {
  constexpr char digits[] = "0123456789abcdef";
  std::cout << '"';
  for (const auto word : words) for (int shift = 28; shift >= 0; shift -= 4) std::cout << digits[(word >> shift) & 15];
  std::cout << '"';
}

struct Sender {
  std::vector<std::uint32_t>& caller;
  std::size_t fail_at, throw_at;
  bool mutate;
  std::size_t attempts = 0;
  std::vector<std::uint32_t> accepted;
  std::vector<std::size_t> counts;
  stdx::error send_ump(const std::uint32_t* words, std::size_t count) {
    ++attempts; counts.push_back(count);
    if (mutate) for (auto& word : caller) word = 0xffffffffu;
    if (attempts == throw_at) throw std::runtime_error("controlled-sender-failure");
    if (attempts == fail_at) return std::errc::io_error;
    accepted.insert(accepted.end(), words, words + count); return {};
  }
};

void batch(Tokens& input) {
  const auto fail = input.number(4096), throws = input.number(4096), mutate = input.number(1);
  const auto count = input.number(lemmings::ump::maximum_words);
  std::vector<std::uint32_t> words; words.reserve(count);
  for (std::size_t i = 0; i < count; ++i) words.push_back(input.number(0xffffffffu, 16));
  input.finish();
  Sender sender{words, fail, throws, bool(mutate), 0, {}, {}};
  sender.accepted.reserve(count); sender.counts.reserve(count);
  const auto result = lemmings::ump::dispatch(words, sender);
  std::cout << "{\"kind\":\"batch\",\"attemptedPackets\":" << result.attempted_packets
            << ",\"acceptedPackets\":" << result.accepted_packets << ",\"acceptedWords\":" << result.accepted_words
            << ",\"failureWordOffset\":" << result.failure_word_offset << ",\"reason\":";
  if (result.reason) std::cout << '"' << result.reason << '"'; else std::cout << "null";
  std::cout << ",\"failedPacketUnconfirmed\":" << (result.failed_packet_unconfirmed ? "true" : "false")
            << ",\"callbackWordCounts\":[";
  for (std::size_t i = 0; i < sender.counts.size(); ++i) { if (i) std::cout << ','; std::cout << sender.counts[i]; }
  std::cout << "],\"acceptedPrefixWords\":"; words_json(sender.accepted);
  std::cout << ",\"acceptedPrefixWireHex\":"; wire_hex(sender.accepted); std::cout << "}\n";
}

void typed(Tokens& input) {
  const auto kind = input.number(3), group = input.number(15), channel = input.number(15);
  const auto index = input.number(127), detail = input.number(kind == 0 ? 255 : 127);
  const auto value = input.number(kind == 0 ? 65535 : 0xffffffffu), attribute = input.number(65535); input.finish();
  if ((kind != 0 && attribute) || (kind == 1 && detail) || (kind == 0 && !detail && attribute)) throw std::invalid_argument("reserved-field");
  midi::universal_packet ni;
  std::uint64_t cmidi = 0;
  switch (kind) {
    case 0:
      ni = midi::make_midi2_note_on_message(group, channel, index, midi::velocity{std::uint16_t(value)}, detail, attribute);
      cmidi = static_cast<std::uint64_t>(cmidi2_ump_midi2_note_on(group, channel, index, detail, value, attribute)); break;
    case 1:
      ni = midi::make_midi2_control_change_message(group, channel, index, midi::controller_value{value});
      cmidi = static_cast<std::uint64_t>(cmidi2_ump_midi2_cc(group, channel, index, value)); break;
    case 2:
      ni = midi::make_registered_controller_message(group, channel, index, detail, midi::controller_value{value});
      cmidi = static_cast<std::uint64_t>(cmidi2_ump_midi2_rpn(group, channel, index, detail, value)); break;
    default:
      ni = midi::make_relative_registered_controller_message(group, channel, index, detail, midi::controller_increment{std::bit_cast<std::int32_t>(value)});
      cmidi = static_cast<std::uint64_t>(cmidi2_ump_midi2_relative_rpn(group, channel, index, detail, value));
  }
  const std::array<std::uint32_t, 2> cmidi_words{std::uint32_t(cmidi >> 32), std::uint32_t(cmidi)};
  std::cout << "{\"kind\":\"typed\",\"ni\":"; words_json({ni.data, 2});
  std::cout << ",\"cmidi2\":"; words_json(cmidi_words);
  std::cout << ",\"niWireHex\":"; wire_hex({ni.data, 2});
  std::cout << ",\"cmidi2WireHex\":"; wire_hex(cmidi_words); std::cout << "}\n";
}

void scale(Tokens& input) {
  const auto from = input.number(32), to = input.number(32), value = input.number(); input.finish();
  if (!from || !to || (from < 32 && value >= (std::uint32_t(1) << from))) throw std::invalid_argument("resolution");
  std::uint32_t result = 0;
  if (from == 7 && to == 16) result = midi::upsample_7_to_16bit(value);
  else if (from == 7 && to == 32) result = midi::upsample_7_to_32bit(value);
  else if (from == 14 && to == 32) result = midi::upsample_14_to_32bit(value);
  else if (from == 16 && to == 7) result = midi::downsample_16_to_7bit(value);
  else if (from == 32 && to == 7) result = midi::downsample_32_to_7bit(value);
  else if (from == 32 && to == 14) result = midi::downsample_32_to_14bit(value);
  else throw std::invalid_argument("unsupported-resolution-pair");
  std::cout << "{\"kind\":\"scale\",\"value\":" << result << "}\n";
}

void widths(Tokens& input) {
  input.finish(); std::cout << "{\"kind\":\"widths\",\"rows\":[";
  for (std::uint32_t type = 0; type < 16; ++type) {
    const midi::universal_packet ni{type << 28, 0x12345678u, 0x90abcdefu, 0x76543210u};
    const libremidi::ump lib{ni}; const midi::universal_packet copy = lib;
    if (type) std::cout << ',';
    std::cout << "{\"type\":" << type << ",\"guard\":" << lemmings::ump::word_counts[type]
              << ",\"ni\":" << ni.size() << ",\"cmidi2\":" << unsigned(cmidi2_ump_get_num_bytes(ni.data[0])) / 4
              << ",\"libremidi\":" << lib.size() << ",\"libremidiIterator\":" << lib.end() - lib.begin()
              << ",\"niRoundtrip\":" << (std::equal(ni.data, ni.data + 4, copy.data) ? "true" : "false") << '}';
  }
  std::cout << "]}\n";
}

void lower(Tokens& input) {
  const auto opcode = input.number(1), value = input.number(opcode ? 0xffffffffu : 65535); input.finish();
  auto ni = opcode ? midi::make_registered_controller_message(0, 0, 0, 0, midi::controller_value{value})
                   : midi::make_midi2_note_on_message(0, 0, 60, midi::velocity{std::uint16_t(value)});
  const auto lowered = midi::as_midi1_channel_voice_message(midi::midi2_channel_voice_message_view{ni});
  std::array<std::uint8_t, 32> bytes{};
  const auto count = cmidi2_convert_single_ump_to_midi1(bytes.data(), bytes.size(), ni.data);
  if (count > bytes.size()) throw std::runtime_error("peer-output-bound");
  std::cout << "{\"kind\":\"lower\",\"niWord\":";
  if (lowered) std::cout << lowered->data[0]; else std::cout << "null";
  std::cout << ",\"cmidi2Bytes\":[";
  for (std::size_t at = 0; at < count; ++at) { if (at) std::cout << ','; std::cout << unsigned(bytes[at]); }
  std::cout << "]}\n";
}

void command(std::string_view line) {
  Tokens input{line}; const auto operation = input.take();
  if (operation == "I") {
    input.finish();
    std::cout << "{\"kind\":\"identity\",\"schema\":\"lemmings-native-midi-codec-peer/v1\",\"deviceIO\":false,\"maximumWords\":4096,\"maximumLineBytes\":65536,\"ni_midi2\":\"" NI_MIDI2_REVISION "\",\"cmidi2\":\"" CMIDI2_REVISION "\",\"libremidi\":\"" LIBREMIDI_REVISION "\"}\n";
  } else if (operation == "W") widths(input);
  else if (operation == "B") batch(input);
  else if (operation == "T") typed(input);
  else if (operation == "S") scale(input);
  else if (operation == "L") lower(input);
  else throw std::invalid_argument("operation");
}
}

int main() {
#ifdef _WIN32
  if (_setmode(_fileno(stdin), _O_BINARY) == -1 || _setmode(_fileno(stdout), _O_BINARY) == -1) return 2;
#endif
  std::array<char, maximum_line_bytes> line{}; std::size_t size = 0; char next = 0;
  while (std::cin.get(next)) {
    if (next != '\n') {
      if (size == line.size() || next == '\0' || next == '\r' || static_cast<unsigned char>(next) > 127) {
        std::cout << "{\"kind\":\"error\",\"reason\":\"line-bound-or-encoding\"}\n"; return 2;
      }
      line[size++] = next; continue;
    }
    try { command({line.data(), size}); }
    catch (const std::invalid_argument&) { std::cout << "{\"kind\":\"error\",\"reason\":\"invalid-command\"}\n"; }
    catch (...) { std::cout << "{\"kind\":\"error\",\"reason\":\"resource-or-peer-failure\"}\n"; return 3; }
    size = 0;
  }
  if (size) { std::cout << "{\"kind\":\"error\",\"reason\":\"unterminated-command\"}\n"; return 2; }
}
