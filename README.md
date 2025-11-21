# Record Mapper

A simple tool for mapping out json objects to desired json structure.


# How to use

## 1. Prepare Input

The input file is the json file that you want to convert. This should be a valid json.


## 2. Update Mapping

The mapping file is what the program will use to reference for how the output structure will look like and what values to input.
The `keys` in the mapping file will be the `keys` for the output file, while the `values` of the mapping file refers to the `keys` of the input file.

As an example, given you have an input file:
```json
{
  "id": "someid",
  "firstName": "First Name",
  "lastName": "Lastname"
}
```
Mapping file:
```json
{
  "id": "id",
  "personalInformation.forename": "firstName",
  "personalInformation.surname": "lastName"
}
```

This configuration will generate an `output.json` file with the following content:
```json
{
  "id": "someid",
  "personalInformation": {
    "forename": "First Name",
    "surname": "Lastname"
  }
}
```

## Setting literal values (constants)

By default, string values in the mapping are treated as source paths to read from the input. If you want to set constants in the output, use one of the following options:

- Non-string literals are already supported and set directly:
  - Booleans: `true` / `false`
  - Numbers: `123`
  - Objects: `{ "a": 1 }`
  - Arrays: `[1, 2, 3]`

- String literals can be expressed in two ways:
  1) Wrapper object using `$literal`:
     ```json
     { "_class": { "$literal": "io.benefexapps.profiles.domain.Profile" } }
     ```
  2) Prefix with `=` to mark a string literal:
     ```json
     { "_class": "=io.benefexapps.profiles.domain.Profile" }
     ```

  If your literal needs to start with an equals sign, escape it by doubling: `"==value"` becomes the literal `"=value"`.

Example snippet inside a mapping file:
```json
{
  "customAttributes.currencyCode": "=GBP",
  "personalInformation.email": [],
  "personalInformation.email[].isVerified": true
}
```

## 3. Run the program

Format: `node main.js <input file> <mapping file> <optional: output file>`. 
Sample: `node main.js input.json mapping.json` or `node main.js input.json mapping.json output.json`.

## Custom transforms (computed fields)

Sometimes you need to compute an output value from one or more input fields. You can do this using the `$transform` syntax in the mapping.

Syntax options:
- Single-argument form using `$path`:
  ```json
  {
    "target.path": { "$transform": "functionName", "$path": "source.path" }
  }
  ```
- Multi-argument form using `$args`:
  ```json
  {
    "target.path": { "$transform": "functionName", "$args": [ "a.b", "=literal", { "$literal": 123 } ] }
  }
  ```

Argument resolution rules:
- Strings are treated as source paths to read from the input (e.g., `"a.b.c"`).
- Strings that start with `=` are treated as string literals (e.g., `"=GBP"` → `"GBP"`).
- Objects like `{ "$literal": ... }` pass their value through as-is (works for any type).
- Non-string values (numbers, booleans, arrays, objects) are passed as-is.

Built-in transforms:
- `countryFromISO(code)`: Converts an ISO 3166-1 alpha-2 region code (e.g., `GB`) into an English country name (e.g., `United Kingdom`).
  - Uses `Intl.DisplayNames` when available, with a small fallback map. If a code is unknown, returns the code itself.

Example: Map `personalInformation.nationality` (e.g., `GB`) to a human-readable `country` field:
```json
{
  "country": { "$transform": "countryFromISO", "$path": "personalInformation.nationality" }
}
```

Notes:
- The rest of the mapping behaviors remain the same (arrays with `[]`, literals, etc.).
- If your mapping file contains comments (`//`), remove them to keep the file valid JSON.

## Source-side array paths (using [] and [n] in mapping values)

You can read from arrays in the input using the following notations in the mapping VALUE (the right-hand side):

- `path.to.list[]` — wildcard over an array. When followed by a property, it plucks that property from every item.
- `path.to.list[0]` — numeric index access. You can combine with properties afterward.

Behavior details:
- If a wildcard `[]` is used anywhere in the source path, the resolved value becomes an array.
- If the TARGET path ends with `[]`, the resolved array is assigned to that target array (replacing its contents).
- If the TARGET path does not end with `[]`, the resolved array is assigned as-is to that property (result is an array property).

Examples:
```json
{
  "emails[]": "contacts[].email",              
  "firstEmail": "contacts[0].email",          
  "departments[]": "employmentDetails[].department", 
  "department": "employmentDetails[0].department"     
}
```

Notes and current limitation:
- Wildcards on the source side create arrays of values. If you need to fan out into arrays of objects (e.g., build N target objects from N source items with multiple subfields each), you typically map each child field to the same target array object using target-side `[]` and source-side wildcards for each field. For example:
  ```json
  {
    "employmentDetails[]": [],
    "employmentDetails[].employeeId": "jobs[].id",
    "employmentDetails[].jobTitle": "jobs[].title"
  }
  ```
  This builds an array at `employmentDetails` and populates parallel fields from `jobs[]`. Items are aligned by index.

## Root-level array inputs

Your input file can also be a JSON array (a list of objects). In that case, the mapper now applies the same mapping to each item and returns an array of mapped outputs with the same length.

Example input (array):
```json
[
  { "id": "1", "firstName": "A", "lastName": "X" },
  { "id": "2", "firstName": "B", "lastName": "Y" }
]
```

Mapping:
```json
{
  "id": "id",
  "personalInformation.forename": "firstName",
  "personalInformation.surname": "lastName"
}
```

Output will be an array:
```json
[
  { "id": "1", "personalInformation": { "forename": "A", "surname": "X" } },
  { "id": "2", "personalInformation": { "forename": "B", "surname": "Y" } }
]
```

Notes:
- CLI usage is unchanged. If the input root is an array, the output root will be an array as well.
- All features (literals, `$transform`, source-side `[]`/`[n]`, target-side `[]`) work per item.