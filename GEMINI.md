# Gemini CLI Rules

## Versioning Mandate
- Whenever any functional code changes or UI enhancements are made, you **MUST** iterate the application version.
- The version must be updated in the following files:
  1. `config.js` (update `APP_VERSION` constant)
  2. `version.json` (update `version` field)
- Follow semantic versioning (e.g., 1.8.8 -> 1.8.9).
- After updating the version, ensure `sw.js` cache version is incremented if new assets were added.
