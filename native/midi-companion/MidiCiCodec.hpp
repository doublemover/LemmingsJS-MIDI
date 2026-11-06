#pragma once
#include "Protocol.hpp"
#include <midi/capability_inquiry.h>
#include <midi/sysex.h>

namespace lemmings::companion {
inline constexpr std::size_t maximum_ci_bytes = 2048;
inline std::string ci_bytes_json(const midi::sysex7 &message) {
  if (message.manufacturerID != midi::manufacturer::universal_non_realtime ||
      !message.is_valid() || message.data.size() + 1 > maximum_ci_bytes)
    throw std::runtime_error("invalid-ci-codec-result");
  std::string result = "[126";
  for (const auto byte : message.data)
    result += "," + std::to_string(byte);
  return result + "]";
}
inline midi::ci::message make_ci_message(Tokens &input) {
  const auto operation = input.take();
  const auto source = static_cast<midi::muid_t>(input.number(0x0ffffeff)),
             destination = static_cast<midi::muid_t>(input.number(0x0fffffff));
  const auto scope = static_cast<midi::uint7_t>(input.number(127));
  if (!source || !(scope <= 15 || scope == 0x7e || scope == 0x7f))
    throw std::invalid_argument("invalid-ci-source-or-scope");
  if (operation == "discovery") {
    const auto maximum = input.number(maximum_ci_bytes);
    input.finish();
    if (maximum < 128)
      throw std::invalid_argument("ci-maximum-message-too-small");
    const midi::device_identity identity{0x7d0000, 0, 0, 1};
    return midi::ci::make_discovery_inquiry(source, identity, 0, maximum, 0);
  }
  if (operation == "discovery-reply") {
    const auto maximum = input.number(maximum_ci_bytes),
               block = input.number(127);
    input.finish();
    if (maximum < 128)
      throw std::invalid_argument("ci-maximum-message-too-small");
    const midi::device_identity identity{0x7d0000, 0, 0, 1};
    return midi::ci::make_discovery_reply(source, destination, identity, 0,
                                          maximum, 0, block);
  }
  if (operation == "endpoint-inquiry") {
    const auto status = input.number(127);
    input.finish();
    return midi::ci::make_endpoint_information_inquiry(source, destination,
                                                       status);
  }
  if (operation == "invalidate") {
    const auto target = input.number(0x0fffffff);
    input.finish();
    return midi::ci::make_invalidate_muid_message(source, target);
  }
  if (operation == "process-inquiry") {
    input.finish();
    if (scope != 127)
      throw std::invalid_argument(
          "process-capabilities-requires-function-block");
    return midi::ci::make_process_inquiry_capabilities_inquiry(
        source, destination, scope);
  }
  if (operation == "message-report") {
    const auto data = input.number(127), system = input.number(127),
               controllers = input.number(127), notes = input.number(127);
    input.finish();
    if ((data != 0 && data != 1 && data != 127) || system > 7 ||
        controllers > 63 || notes > 31 || (system && scope != 127))
      throw std::invalid_argument("invalid-message-report-categories");
    return midi::ci::make_midi_message_report_inquiry(
        source, destination, data, system, controllers, notes, scope);
  }
  if (operation == "nak") {
    const auto transaction = input.number(127), status = input.number(127),
               detail = input.number(127);
    input.finish();
    midi::uint7_t details[5]{};
    return midi::ci::make_nak_message(source, destination, scope, transaction,
                                      status, detail, details,
                                      "Unsupported request");
  }
  throw std::invalid_argument("unsupported-ci-constructor");
}
inline std::string encode_ci(Tokens &input) {
  const auto group = static_cast<midi::group_t>(input.number(15));
  const auto message = make_ci_message(input);
  std::vector<std::uint32_t> words;
  words.reserve((message.data.size() + 6) / 6 * 2);
  midi::send_sysex7(message, group, [&](const midi::data_message &packet) {
    words.push_back(packet.data[0]);
    words.push_back(packet.data[1]);
  });
  return "\"codec\":\"ni-midi2:" NI_MIDI2_REVISION
         "\",\"identityTier\":\"non-commercial-development-id\",\"bytes\":" +
         ci_bytes_json(message) + ",\"words\":" + words_json(words);
}
inline std::string decode_ci(Tokens &input) {
  const auto count = input.number(maximum_ci_bytes);
  if (count < 13)
    throw std::invalid_argument("truncated-ci-envelope");
  std::vector<midi::uint7_t> bytes;
  bytes.reserve(count);
  for (std::size_t index = 0; index < count; ++index)
    bytes.push_back(static_cast<midi::uint7_t>(input.number(127)));
  input.finish();
  if (bytes[0] != 0x7e)
    throw std::invalid_argument("not-non-realtime-ci");
  midi::sysex7 message{midi::manufacturer::universal_non_realtime,
                       bytes.data() + 1, bytes.size() - 1};
  if (!message.is_valid() || !midi::capability_inquiry_view::validate(message))
    throw std::invalid_argument("malformed-ci-envelope");
  const midi::capability_inquiry_view base{message};
  if (base.message_version() != 1 && base.message_version() != 2)
    throw std::invalid_argument("unsupported-ci-version");
  const auto subtype = midi::universal_sysex_subtype_of(message);
  std::string result =
      "\"codec\":\"ni-midi2:" NI_MIDI2_REVISION "\",\"version\":" +
      std::to_string(base.message_version()) +
      ",\"sourceMuid\":" + std::to_string(base.source_muid()) +
      ",\"destinationMuid\":" + std::to_string(base.destination_muid()) +
      ",\"scope\":" +
      std::to_string(midi::universal_sysex_device_id_of(message)) +
      ",\"subtype\":" + std::to_string(subtype);
  bool known = false;
  const auto discovery = [&](const auto &view) {
    const auto identity = view.identity();
    return ",\"identity\":{\"manufacturer\":" +
           std::to_string(identity.manufacturer) +
           ",\"family\":" + std::to_string(identity.family) +
           ",\"model\":" + std::to_string(identity.model) +
           ",\"revision\":" + std::to_string(identity.revision) +
           "},\"categories\":" + std::to_string(view.categories()) +
           ",\"maximumMessageBytes\":" +
           std::to_string(view.maximum_message_size()) +
           ",\"outputPathId\":" + std::to_string(view.output_path_id());
  };
  switch (subtype) {
  case midi::ci::subtype::discovery_inquiry: {
    const auto view = midi::ci::as<midi::ci::discovery_inquiry_view>(message);
    if (!view)
      throw std::invalid_argument("malformed-ci-discovery");
    result += discovery(*view);
    known = true;
    break;
  }
  case midi::ci::subtype::discovery_reply: {
    const auto view = midi::ci::as<midi::ci::discovery_reply_view>(message);
    if (!view)
      throw std::invalid_argument("malformed-ci-discovery-reply");
    result += discovery(*view) +
              ",\"functionBlock\":" + std::to_string(view->function_block());
    known = true;
    break;
  }
  case midi::ci::subtype::endpoint_information_reply: {
    const auto view =
        midi::ci::as<midi::ci::endpoint_information_reply_view>(message);
    if (!view)
      throw std::invalid_argument("malformed-ci-endpoint-reply");
    const auto length = view->information_data_length();
    if (length > maximum_ci_bytes ||
        message.data.size() < midi::ci::endpoint_information_reply_view::
                                      field_offsets::information_data +
                                  length)
      throw std::invalid_argument("ci-endpoint-data-length");
    result += ",\"status\":" + std::to_string(view->status()) +
              ",\"informationData\":[";
    for (std::size_t index = 0; index < length; ++index) {
      if (index)
        result += ',';
      result += std::to_string(view->information_data()[index]);
    }
    result += ']';
    known = true;
    break;
  }
  case midi::ci::subtype::invalidate_muid: {
    const auto view = midi::ci::as<midi::ci::invalidate_muid_view>(message);
    if (!view)
      throw std::invalid_argument("malformed-ci-invalidation");
    result += ",\"targetMuid\":" + std::to_string(view->target_muid());
    known = true;
    break;
  }
  case midi::ci::subtype::process_inquiry_capabilities_reply: {
    const auto view =
        midi::ci::as<midi::ci::process_inquiry_capabilities_reply_view>(
            message);
    if (!view)
      throw std::invalid_argument("malformed-ci-process-reply");
    result +=
        ",\"supportedFeatures\":" + std::to_string(view->supported_features());
    known = true;
    break;
  }
  case midi::ci::subtype::midi_message_report_reply: {
    const auto view =
        midi::ci::as<midi::ci::midi_message_report_reply_view>(message);
    if (!view)
      throw std::invalid_argument("malformed-ci-report-reply");
    if (message.data[midi::ci::midi_message_report_reply_view::field_offsets::
                         _reserved_control] ||
        view->system_message_types() > 7 ||
        view->channel_controller_message_types() > 63 ||
        view->note_data_message_types() > 31)
      throw std::invalid_argument("reserved-message-report-field");
    result +=
        ",\"systemTypes\":" + std::to_string(view->system_message_types()) +
        ",\"controllerTypes\":" +
        std::to_string(view->channel_controller_message_types()) +
        ",\"noteTypes\":" + std::to_string(view->note_data_message_types());
    known = true;
    break;
  }
  case midi::ci::subtype::midi_message_report_end:
    known = message.data.size() ==
            midi::capability_inquiry_view::field_offsets::payload;
    if (!known)
      throw std::invalid_argument("malformed-ci-report-end");
    break;
  case midi::ci::subtype::ack:
  case midi::ci::subtype::nak: {
    if (base.message_version() == 1 && subtype == midi::ci::subtype::nak) {
      if (message.data.size() !=
          midi::capability_inquiry_view::field_offsets::payload)
        throw std::invalid_argument("malformed-ci-v1-nak");
      known = true;
      break;
    }
    if (message.data.size() < midi::ci::nack::view::field_offsets::message_data)
      throw std::invalid_argument("truncated-ci-status");
    if (subtype == midi::ci::subtype::ack
            ? !midi::ci::ack_view::validate(message)
            : !midi::ci::nak_view::validate(message))
      throw std::invalid_argument("malformed-ci-ack-nak");
    const midi::ci::nack::view view{message};
    const auto length = view.message_length();
    if (length > maximum_ci_bytes ||
        message.data.size() <
            midi::ci::nack::view::field_offsets::message_data + length)
      throw std::invalid_argument("ci-status-text-length");
    result += ",\"transaction\":" + std::to_string(view.transaction()) +
              ",\"statusCode\":" + std::to_string(view.status_code()) +
              ",\"statusData\":" + std::to_string(view.status_data()) +
              ",\"message\":" + quote(view.message());
    known = true;
    break;
  }
  default:
    break;
  }
  return result + ",\"known\":" + (known ? "true" : "false");
}
} // namespace lemmings::companion
