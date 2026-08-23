# Demo snapshot (F7)

`callback-demo.sqlite` goes here once seed data exists (after M1/S1). It is
the one exception to `.gitignore`'s `data/*.sqlite` rule — commit it so the
ledger and approval pages render even with the network disabled (F7
acceptance: "with network disabled the ledger and approval pages still
render from the snapshot").

To regenerate it once real seed data exists:

```bash
cp data/callback.sqlite data/demo/callback-demo.sqlite
```
