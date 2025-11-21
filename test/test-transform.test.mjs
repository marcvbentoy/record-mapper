import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from '../main.js';

describe('transform (unit)', () => {
  test('copies scalars and creates nested structures', () => {
    const input = { id: '123', firstName: 'John', lastName: 'Doe' };
    const mapping = {
      'id': 'id',
      'personalInformation.forename': 'firstName',
      'personalInformation.surname': 'lastName'
    };
    const out = transform(input, mapping);
    assert.deepEqual(out, {
      id: '123',
      personalInformation: { forename: 'John', surname: 'Doe' }
    });
  });

  test('supports non-string literals + string literal prefix', () => {
    const input = { v: 1 };
    const mapping = {
      'a': true,
      'b': 123,
      'c': { x: 1 },
      'd': [1,2],
      'e': '=hello',
      'f': { $literal: '=hello' }
    };
    const out = transform(input, mapping);
    assert.deepEqual(out, { a: true, b: 123, c: { x: 1 }, d: [1,2], e: 'hello', f: '=hello' });
  });

  test('source-side wildcard and index with and without target []', () => {
    const input = { contacts: [ { email: 'a@x' }, { email: 'b@y' } ] };
    const mapping = {
      'emails[]': 'contacts[].email',  // assign array to target []
      'firstEmail': 'contacts[0].email',
      'allEmails': 'contacts[].email'   // becomes an array on property
    };
    const out = transform(input, mapping);
    assert.deepEqual(out, {
      emails: ['a@x', 'b@y'],
      firstEmail: 'a@x',
      allEmails: ['a@x', 'b@y']
    });
  });

  test('$transform with $path and $args', () => {
    const input = { person: { nationality: 'GB' } };
    const mapping = {
      'country1': { $transform: 'countryFromISO', $path: 'person.nationality' },
      'country2': { $transform: 'countryFromISO', $args: ['person.nationality'] },
      'country3': { $transform: 'countryFromISO', $args: ['=US'] }
    };
    const out = transform(input, mapping);
    assert.equal(out.country1, 'United Kingdom');
    assert.equal(out.country2, 'United Kingdom');
    assert.equal(out.country3, 'United States');
  });

  test('root-level array input maps per item', () => {
    const input = [
      { id: '1', firstName: 'A', lastName: 'X' },
      { id: '2', firstName: 'B', lastName: 'Y' }
    ];
    const mapping = {
      'id': 'id',
      'personalInformation.forename': 'firstName',
      'personalInformation.surname': 'lastName'
    };
    const out = transform(input, mapping);
    assert.ok(Array.isArray(out));
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { id: '1', personalInformation: { forename: 'A', surname: 'X' } });
    assert.deepEqual(out[1], { id: '2', personalInformation: { forename: 'B', surname: 'Y' } });
  });
});

describe('transform (integration with provided files)', () => {
  let unifiedInput, unifiedToProfileMapping, profileInput, profileToUnifiedMapping;
  before(() => {
    unifiedInput = JSON.parse(fs.readFileSync(new URL('../input-unified.json', import.meta.url)));
    unifiedToProfileMapping = JSON.parse(fs.readFileSync(new URL('../mapping-unified-to-profile.json', import.meta.url)));
    profileInput = JSON.parse(fs.readFileSync(new URL('../input-profile.json', import.meta.url)));
    profileToUnifiedMapping = JSON.parse(fs.readFileSync(new URL('../mapping-profile-to-unified.json', import.meta.url)));
  });

  test('unified -> profile mapping basic fields and transform (root array input)', () => {
    const out = transform(unifiedInput, unifiedToProfileMapping);
    assert.ok(Array.isArray(out));
    assert.equal(out.length, unifiedInput.length);
    const firstIn = unifiedInput[0];
    const firstOut = out[0];
    // Deterministic subset assertions on first item
    assert.equal(firstOut._class, 'io.benefexapps.profiles.domain.Profile'); // string literal via =
    assert.equal(firstOut.company, firstIn.companyId);
    assert.equal(firstOut.firstName, firstIn.personalInformation.forename);
    assert.equal(firstOut.lastName, firstIn.personalInformation.surname);
    assert.equal(firstOut.country, 'United Kingdom'); // from nationality GB via transform
    assert.equal(firstOut.employeeKey, firstIn.employmentDetails[0].employeeId);
    assert.equal(firstOut.status, firstIn.employmentDetails[0].employmentStatus);
    assert.equal(firstOut.email, firstIn.employmentDetails[0].workEmail);
  });

  test('profile -> unified mapping arrays and nested objects', () => {
    const out = transform(profileInput, profileToUnifiedMapping);
    // personalInformation.email is an array of objects with properties populated
    assert.ok(Array.isArray(out.personalInformation.email));
    assert.equal(out.personalInformation.email.length, 1);
    assert.deepEqual(out.personalInformation.email[0], {
      email: profileInput.email,
      isPrimary: true,
      isVerified: true
    });

    // employmentDetails[] fields map correctly
    assert.ok(Array.isArray(out.employmentDetails));
    assert.equal(out.employmentDetails.length, 1);
    const ed = out.employmentDetails[0];
    assert.equal(ed.employeeId, profileInput.employeeKey);
    assert.equal(ed.department, profileInput.department);
    assert.equal(ed.workEmail, profileInput.email);
  });
});
