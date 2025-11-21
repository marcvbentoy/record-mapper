import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getValueByPath, setValueByPath, resolveSpec, transforms } from '../main.js';

describe('getValueByPath', () => {
  test('reads simple dot paths', () => {
    const obj = { a: { b: { c: 42 } } };
    assert.equal(getValueByPath(obj, 'a.b.c'), 42);
  });

  test('reads array index [n]', () => {
    const obj = { list: [ { v: 1 }, { v: 2 } ] };
    assert.equal(getValueByPath(obj, 'list[1].v'), 2);
  });

  test('reads array wildcard [] and flattens one level', () => {
    const obj = { list: [ { v: 1 }, { v: 2 }, { v: 3 } ] };
    assert.deepEqual(getValueByPath(obj, 'list[].v'), [1, 2, 3]);
  });

  test('wildcard on non-array treats single value as 1-length array', () => {
    const obj = { x: { v: 7 } };
    assert.deepEqual(getValueByPath(obj, 'x[].v'), [7]);
  });

  test('nested wildcards flatten per step', () => {
    const obj = { a: [ { b: [1,2] }, { b: [3] } ] };
    assert.deepEqual(getValueByPath(obj, 'a[].b[]'), [1,2,3]);
  });

  test('returns undefined for missing path', () => {
    const obj = { a: {} };
    assert.equal(getValueByPath(obj, 'a.b.c'), undefined);
  });
});

describe('setValueByPath', () => {
  test('creates nested objects as needed', () => {
    const t = {};
    setValueByPath(t, 'a.b.c', 10);
    assert.deepEqual(t, { a: { b: { c: 10 } } });
  });

  test('last segment [] pushes scalars', () => {
    const t = {};
    setValueByPath(t, 'nums[]', 1);
    setValueByPath(t, 'nums[]', 2);
    assert.deepEqual(t, { nums: [1,2] });
  });

  test('last segment [] assigns array when value is array', () => {
    const t = {};
    setValueByPath(t, 'nums[]', [3,4]);
    assert.deepEqual(t, { nums: [3,4] });
  });

  test('mid-path [] uses index 0 object as carrier', () => {
    const t = {};
    setValueByPath(t, 'emails[].email', 'a@b.com');
    setValueByPath(t, 'emails[].isPrimary', true);
    assert.deepEqual(t, { emails: [ { email: 'a@b.com', isPrimary: true } ] });
  });
});

describe('resolveSpec', () => {
  test('resolves string as path', () => {
    const input = { a: { b: 5 } };
    assert.equal(resolveSpec(input, 'a.b'), 5);
  });

  test('passes through non-strings', () => {
    const input = {};
    assert.equal(resolveSpec(input, 123), 123);
    assert.equal(resolveSpec(input, true), true);
    assert.deepEqual(resolveSpec(input, { x: 1 }), { x: 1 });
  });

  test('supports string literal prefix =', () => {
    const input = {};
    assert.equal(resolveSpec(input, '=GBP'), 'GBP');
    assert.equal(resolveSpec(input, '==lead'), '=lead');
  });

  test('supports {$literal: ...} wrapper', () => {
    const input = {};
    assert.deepEqual(resolveSpec(input, { $literal: { a: 1 } }), { a: 1 });
  });
});

describe('transforms.countryFromISO', () => {
  test('maps known codes to names', () => {
    assert.equal(transforms.countryFromISO('GB'), 'United Kingdom');
  });

  test('returns code for unknown', () => {
    assert.equal(transforms.countryFromISO('XX'), 'XX');
  });
});
