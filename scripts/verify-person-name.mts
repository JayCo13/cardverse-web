import assert from 'node:assert/strict';
import { namesMatch, normalizeVietnameseName } from '@/lib/person-name';
import { namesMatch as serverNamesMatch } from '@/lib/kyc-verification';

const cases: Array<[string, string, boolean]> = [
  ['Đỗ Nguyên', 'DO NGUYEN', true],
  ['ĐÕ NGUYỄN', 'DO NGUYEN', true],
  ['đỗ nguyên', 'do nguyen', true],
  ['  Đỗ\t Nguyên\n', ' DO  NGUYEN ', true],
  ['Đỗ Nguyên'.normalize('NFD'), 'DO NGUYEN', true],
  ['Đỗ Nguyên'.normalize('NFC'), 'Đỗ Nguyên'.normalize('NFD'), true],
  ['QUACH THANH NHA', 'Quách Thành Nhã', true],
  ['CO TRINH HIEN TAI', 'TAI CO TRINH HIEN', true],
  ['Đỗ Nguyên', 'DO', false],
  ['Đỗ Nguyên', 'DO VAN NGUYEN', false],
  ['Đỗ Nguyên', 'DO NGUYEN A', false],
  ['Đỗ Nguyên', 'DO DO NGUYEN', false],
  ['Đỗ Nguyên', 'DO NGUYEN NGUYEN', false],
  ['Đỗ Nguyên', 'HO NGUYEN', false],
  ['Đỗ Nguyên', 'O NGUYEN', false],
  ['Đỗ Nguyên', 'DO NGUYN', false],
  ['', '', false],
  ['   ', '\t', false],
  ['123!@#', '456!?', false],
  ['', 'DO NGUYEN', false],
];

assert.equal(normalizeVietnameseName('Đỗ Nguyên'), 'DO NGUYEN');
assert.equal(normalizeVietnameseName('đ Đ'), 'D D');
assert.equal(serverNamesMatch, namesMatch, 'Backend must use the shared function');
for (const [identity, bank, expected] of cases) {
  assert.equal(namesMatch(identity, bank), expected, `${identity} / ${bank}`);
  assert.equal(namesMatch(bank, identity), expected, `Reverse: ${bank} / ${identity}`);
}
console.log(`Passed ${cases.length} name comparison cases in both directions and normalization/export checks.`);
