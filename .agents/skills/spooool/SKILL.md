```markdown
# spooool Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `spooool` TypeScript repository. You'll learn about file naming, import/export styles, commit message conventions, and how to write and run tests. This guide is designed to help contributors maintain consistency and quality across the codebase.

## Coding Conventions

### File Naming
- **Style:** kebab-case
- **Example:**  
  ```
  user-profile.ts
  data-fetcher.test.ts
  ```

### Import Style
- **Style:** Mixed (both named and default imports may be used)
- **Example:**
  ```typescript
  import { fetchData } from './data-fetcher';
  import utils from './utils';
  ```

### Export Style
- **Style:** Named exports
- **Example:**
  ```typescript
  // In user-profile.ts
  export function getUserProfile(id: string) { ... }
  export const USER_ROLE = 'admin';
  ```

### Commit Messages
- **Type:** Conventional Commits
- **Prefix:** `feat`
- **Example:**
  ```
  feat: add user authentication middleware
  ```

## Workflows

### Feature Development
**Trigger:** When adding a new feature or module  
**Command:** `/feature-dev`

1. Create a new file using kebab-case naming.
2. Write your TypeScript code using named exports.
3. Import dependencies using the mixed import style as needed.
4. Write corresponding tests in a `.test.ts` file.
5. Commit your changes using the `feat:` prefix and a concise description.
6. Open a pull request for review.

### Testing
**Trigger:** When verifying code correctness  
**Command:** `/run-tests`

1. Ensure your test file follows the `*.test.*` pattern (e.g., `user-profile.test.ts`).
2. Run the test suite using your preferred TypeScript test runner.
3. Review test results and fix any failing tests before committing.

## Testing Patterns

- **Test File Pattern:** `*.test.*` (e.g., `feature-x.test.ts`)
- **Framework:** Not explicitly detected; use your preferred TypeScript-compatible test runner (e.g., Jest, Mocha).
- **Example:**
  ```typescript
  // data-fetcher.test.ts
  import { fetchData } from './data-fetcher';

  test('fetchData returns correct data', () => {
    expect(fetchData('input')).toEqual('expected output');
  });
  ```

## Commands
| Command        | Purpose                                      |
|----------------|----------------------------------------------|
| /feature-dev   | Start a new feature development workflow      |
| /run-tests     | Run all test files in the repository          |
```
