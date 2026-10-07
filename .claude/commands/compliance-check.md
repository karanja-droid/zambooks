---
description: Lint the compliance register and list unverified statutory values
---
Run `pnpm check:register`. Then list every register entry whose status is VERIFY, with its implementation location, and every value under packages/tax-zm/rates/ that has no register entry. Never change a status.
