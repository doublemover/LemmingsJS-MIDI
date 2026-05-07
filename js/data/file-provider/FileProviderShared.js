import { BaseLogger } from '../../util/LogHandler.js';
import { BinaryReader } from '../BinaryReader.js';
import { getDependency, getRuntimeDependency } from '../../core/dependencies.js';
import { appendRevisionParam, sanitizeCacheBust } from '../../core/cacheBust.js';
import '../../util/LogHandler.js';

const LOCAL_STORAGE_PREFIX = 'lem-cache:';
const LOCAL_STORAGE_MAX_BYTES = 4 * 1024 * 1024;
const IDB_NAME = 'lemmings-cache';
const IDB_VERSION = 1;
const IDB_STORE_ENTRIES = 'entries';
const IDB_STORE_PAYLOADS = 'payloads';
const IDB_STORE_META = 'meta';
const IDB_MAX_BYTES = 50 * 1024 * 1024;

export {
  BaseLogger,
  BinaryReader,
  IDB_MAX_BYTES,
  IDB_NAME,
  IDB_STORE_ENTRIES,
  IDB_STORE_META,
  IDB_STORE_PAYLOADS,
  IDB_VERSION,
  LOCAL_STORAGE_MAX_BYTES,
  LOCAL_STORAGE_PREFIX,
  appendRevisionParam,
  getDependency,
  getRuntimeDependency,
  sanitizeCacheBust
};
