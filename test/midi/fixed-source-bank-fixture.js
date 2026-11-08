import { createOwnedSourceBankPlanes } from '../../js/app/resources/OwnedSourceBankData.js';
import { OWNED_SOURCE_BANK_SCHEMA, getOwnedSourceBankIdentity } from '../../js/app/midi-ui/OwnedSourceBank.js';

export const fixedSourceBank = id => ({ schema: OWNED_SOURCE_BANK_SCHEMA, id, ...getOwnedSourceBankIdentity(id), planes: createOwnedSourceBankPlanes(id) });
