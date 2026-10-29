cmake_minimum_required(VERSION 3.24)
project(lemmings_native_midi_codec LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
include(FetchContent)
find_package(Git REQUIRED)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/dependencies.json" dependency_lock)

foreach(dependency IN ITEMS ni_midi2 cmidi2 libremidi)
  string(JSON repository GET "${dependency_lock}" "${dependency}" repository)
  string(JSON revision GET "${dependency_lock}" "${dependency}" revision)
  set(${dependency}_REVISION "${revision}")
  string(LENGTH "${revision}" revision_length)
  if(NOT revision_length EQUAL 40 OR NOT revision MATCHES "^[0-9a-f]+$")
    message(FATAL_ERROR "A full immutable dependency revision is required: ${dependency}")
  endif()
  set(source_only "")
  if(NOT dependency STREQUAL "ni_midi2")
    set(source_only SOURCE_SUBDIR qualification-source-only)
  endif()
  FetchContent_Declare(${dependency}
    GIT_REPOSITORY "${repository}" GIT_TAG "${revision}" GIT_SUBMODULES ""
    GIT_CONFIG core.autocrlf=false ${source_only})
endforeach()
set(NIMIDI2_TESTS OFF CACHE BOOL "" FORCE)
set(NIMIDI2_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(ni_midi2 cmidi2 libremidi)

foreach(dependency IN ITEMS ni_midi2 cmidi2 libremidi)
  string(JSON expected GET "${dependency_lock}" "${dependency}" revision)
  execute_process(COMMAND "${GIT_EXECUTABLE}" -C "${${dependency}_SOURCE_DIR}" rev-parse HEAD
    OUTPUT_VARIABLE actual OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
  if(NOT actual STREQUAL expected)
    message(FATAL_ERROR "Dependency checkout differs from its immutable lock: ${dependency}")
  endif()
  execute_process(COMMAND "${GIT_EXECUTABLE}" -C "${${dependency}_SOURCE_DIR}" diff --quiet HEAD
    RESULT_VARIABLE dirty)
  execute_process(COMMAND "${GIT_EXECUTABLE}" -C "${${dependency}_SOURCE_DIR}" ls-files --others --exclude-standard
    OUTPUT_VARIABLE untracked OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
  if(NOT dirty EQUAL 0 OR NOT untracked STREQUAL "")
    message(FATAL_ERROR "Dependency source was modified: ${dependency}")
  endif()
endforeach()

add_executable(lemmings-midi-codec peer.cpp)
target_link_libraries(lemmings-midi-codec PRIVATE ni::midi2)
target_include_directories(lemmings-midi-codec SYSTEM PRIVATE
  "${cmidi2_SOURCE_DIR}" "${libremidi_SOURCE_DIR}/include" "${ni_midi2_SOURCE_DIR}/inc")
target_compile_definitions(lemmings-midi-codec PRIVATE
  LIBREMIDI_NO_BOOST=1 LIBREMIDI_NO_BOOST_VARIANT2=1 LIBREMIDI_USE_NI_MIDI2=1
  NI_MIDI2_REVISION="${ni_midi2_REVISION}" CMIDI2_REVISION="${cmidi2_REVISION}"
  LIBREMIDI_REVISION="${libremidi_REVISION}")
if(CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC")
  target_compile_options(lemmings-midi-codec PRIVATE /W4)
else()
  target_compile_options(lemmings-midi-codec PRIVATE -Wall -Wextra -Wpedantic)
endif()
