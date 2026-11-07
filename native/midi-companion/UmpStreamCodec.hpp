#pragma once
#include "Protocol.hpp"
#include <midi/stream_message.h>
#include <array>

namespace lemmings::companion {
inline std::string encode_stream(Tokens &input) {
  const auto operation = input.take();
  midi::stream_message message;
  if (operation == "endpoint-discovery") {
    const auto filter = input.number(31); input.finish();
    if (!filter) throw std::invalid_argument("empty-endpoint-discovery");
    message = midi::make_endpoint_discovery_message(filter, 1, 1);
  } else if (operation == "function-block-discovery") {
    const auto block = input.number(255), filter = input.number(3); input.finish();
    if ((block > 31 && block != 255) || !filter)
      throw std::invalid_argument("invalid-function-block-discovery");
    message = midi::make_function_block_discovery_message(block, filter);
  } else if (operation == "stream-configuration") {
    const auto protocol = input.number(2), extensions = input.number(3); input.finish();
    if (!protocol) throw std::invalid_argument("invalid-stream-protocol");
    message = midi::make_stream_configuration_request(protocol, extensions);
  } else throw std::invalid_argument("unsupported-stream-constructor");
  return "\"codec\":\"ni-midi2:" NI_MIDI2_REVISION "\",\"words\":" +
         words_json(std::span<const std::uint32_t>{message.data, 4});
}
inline std::string decode_stream(Tokens &input) {
  std::array<std::uint32_t, 4> words{};
  for (auto &word : words) word = static_cast<std::uint32_t>(input.number(0xffffffffULL, 16));
  input.finish();
  const midi::universal_packet packet{words[0], words[1], words[2], words[3]};
  if (!midi::is_stream_message(packet)) throw std::invalid_argument("not-stream-message");
  const auto status = (words[0] >> 16) & 1023, format = (words[0] >> 26) & 3;
  std::string result = "\"codec\":\"ni-midi2:" NI_MIDI2_REVISION "\",\"status\":" + std::to_string(status);
  bool known = false;
  if (status == 1) {
    if (format || (words[1] & 0x00fffcfc) || words[2] || words[3])
      throw std::invalid_argument("reserved-endpoint-info-bits");
    const midi::endpoint_info_view view{packet};
    if (view.num_function_blocks() > 32 || !view.protocols())
      throw std::invalid_argument("invalid-endpoint-info");
    result += ",\"umpMajor\":" + std::to_string(view.ump_version_major()) +
              ",\"umpMinor\":" + std::to_string(view.ump_version_minor()) +
              ",\"functionBlockCount\":" + std::to_string(view.num_function_blocks()) +
              ",\"staticFunctionBlocks\":" + (view.static_function_blocks() ? "true" : "false") +
              ",\"supportedProtocols\":" + std::to_string(view.protocols()) +
              ",\"jrCapabilities\":" + std::to_string(view.extensions()); known = true;
  } else if (status == 2) {
    if (format || (words[0] & 65535) || (words[1] & 0xff808080) ||
        (words[2] & 0x80808080) || (words[3] & 0x80808080))
      throw std::invalid_argument("reserved-stream-identity-bits");
    const auto identity = midi::device_identity_view{packet}.identity();
    result += ",\"identity\":{\"manufacturer\":" + std::to_string(identity.manufacturer) +
              ",\"family\":" + std::to_string(identity.family) + ",\"model\":" + std::to_string(identity.model) +
              ",\"revision\":" + std::to_string(identity.revision) + "}"; known = true;
  } else if (status == 6) {
    if (format || (words[0] & 0xfcfc) || words[1] || words[2] || words[3])
      throw std::invalid_argument("reserved-stream-configuration-bits");
    const midi::stream_configuration_view view{packet};
    if (view.protocol() != 1 && view.protocol() != 2)
      throw std::invalid_argument("invalid-active-stream-protocol");
    result += ",\"protocol\":" + std::to_string(view.protocol()) +
              ",\"extensions\":" + std::to_string(view.extensions()); known = true;
  } else if (status == 17) {
    if (format || (words[0] & 0xc0) || words[2] || words[3])
      throw std::invalid_argument("reserved-function-block-bits");
    const midi::function_block_info_view view{packet};
    if (view.function_block() > 31 || (view.active() && (!view.direction() || view.midi1() > 2 ||
        view.first_group() > 15 || !view.num_groups_spanned() ||
        view.first_group() + view.num_groups_spanned() > 16 ||
        (view.midi1() && view.num_groups_spanned() != 1))))
      throw std::invalid_argument("invalid-function-block-metadata");
    result += ",\"number\":" + std::to_string(view.function_block()) +
              ",\"active\":" + (view.active() ? "true" : "false") +
              ",\"direction\":" + std::to_string(view.direction()) +
              ",\"midi1\":" + std::to_string(view.midi1()) +
              ",\"uiHint\":" + std::to_string(view.ui_hint()) +
              ",\"firstGroup\":" + std::to_string(view.first_group()) +
              ",\"groupCount\":" + std::to_string(view.num_groups_spanned()) +
              ",\"ciVersion\":" + std::to_string(view.ci_message_version()) +
              ",\"maximumSysex8Streams\":" + std::to_string(view.max_num_sysex8_streams()); known = true;
  }
  return result + ",\"known\":" + (known ? "true" : "false");
}
} // namespace lemmings::companion
