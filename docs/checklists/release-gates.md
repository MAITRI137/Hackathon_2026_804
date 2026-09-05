# Release / Hackathon Winning Gates

## Gate A — Official completeness
Every official requirement is IMPLEMENTED and mapped to acceptance evidence.

## Gate B — Payroll integrity
- decimal-safe calculations;
- fixed/%/formula tests;
- contract context;
- duplicate Payslip prevention;
- legal Payrun states;
- paid immutability;
- leave allocation correctness.

## Gate C — Role/privacy
Walk all five roles.
Direct unauthorized API requests fail.
Employee organization-wide salary leakage = zero.

## Gate D — Productivity
Measure:
- open active Payrun;
- approve leave;
- resolve blocker;
- create recurring Payrun;
- open Explainable Payslip;
- global search/action launcher.
Remove unnecessary steps.

## Gate E — Advanced completeness
All D–L features in `references/requirements.md` either VERIFIED or have a documented real blocker approved by the user. No silent omission.

## Gate F — Visual/motion
- light system only;
- correct Brand/Accent;
- consistent Lucide iconography;
- sophisticated but restrained micro-interactions;
- responsive;
- no browser-default-looking custom controls where the design system defines one.

## Gate G — Real outputs
- actual PDF generated and inspected;
- delivery/outbox exercised;
- CSV/report exports exercised;
- graphs change when DB data changes.

## Gate H — Reliability
- internet-off core demo;
- email failure;
- duplicate click;
- zero-data reports;
- stale UI after mutation;
- production build.

## Gate I — Demo
Show:
1. active Payroll Manager workspace;
2. readiness/blocker;
3. resolve or block invalid state;
4. compute;
5. Explainable Payslip;
6. “Why did salary change?” or simulation;
7. role/privacy proof;
8. dynamic graph change;
9. real PDF;
10. architecture/test close.

No demo time spent on signup, password recovery, or generic admin CRUD.
