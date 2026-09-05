# Research Basis and Applied UX Decisions

The skill combines the uploaded PeoplePay360 predevelopment pack with external research and official product documentation.

## Odoo payroll domain model

Official Odoo Payroll documentation describes payroll as a connected system in which contracts define compensation and working schedules, work entries derive from attendance/planning/time data, issues must be resolved before payroll proceeds, and payslips are then processed and paid.

Applied decision:
- Keep Employee → Contract → Schedule/Attendance/Leave → Payrun → Payslip as the primary product spine.
- Block payroll when context is ambiguous or incomplete.
- Do not treat modules as independent CRUD pages.

Sources:
- https://www.odoo.com/documentation/19.0/applications/hr/payroll.html
- https://www.odoo.com/documentation/19.0/applications/hr/payroll/contracts.html
- https://www.odoo.com/documentation/18.0/applications/hr/payroll/working_schedules.html
- https://www.odoo.com/documentation/18.0/applications/hr/payroll/payslips.html

## Odoo salary rules

Odoo documents salary rules as ordered by sequence; lower-sequence rules calculate before higher-sequence rules and earlier results can feed later rules.

Applied decision:
- Keep salary-rule execution sequence-based.
- Do not build a bespoke rule compiler or generalized dependency DAG.

Source:
- https://www.odoo.com/documentation/19.0/applications/hr/payroll/salaries.html

## Progressive disclosure

Nielsen Norman Group recommends showing common/important choices first and revealing advanced options on request.

Applied decision:
- Core forms show the common required fields first.
- Advanced contract/salary/rule options live in secondary disclosure.
- Use at most two practical disclosure levels.

Source:
- https://www.nngroup.com/articles/progressive-disclosure/

## Generic commands

NN/g notes that reusing a small set of generic commands reduces complexity while preserving power.

Applied decision:
- Use consistent verbs across modules: Create, Edit, Approve, Resolve, Compute, Validate, Pay, Send, Explain, Export.
- Do not invent unique interaction vocabulary per screen.

Source:
- https://www.nngroup.com/articles/generic-commands/

## Dense data productivity

Carbon Design System recommends selection and batch actions for repetitive table work, expandable rows for progressive detail, and inline actions when there are only a few common row actions.

Applied decision:
- Multi-select + batch action bar.
- Inline common actions; overflow for uncommon actions.
- Expand or sidecar for supplementary detail.

Source:
- https://carbondesignsystem.com/components/data-table/usage/

## Validation and recovery

GOV.UK guidance emphasizes specific errors that explain what happened and how to fix it, preserving the user's submitted data rather than clearing it.

Applied decision:
- Preserve user input after errors.
- Specific field errors plus summary for complex forms.
- Permission failures are not presented as ordinary validation errors.

Sources:
- https://design-system.service.gov.uk/components/error-message/
- https://design-system.service.gov.uk/patterns/validation/

## Motion

Apple's Human Interface Guidelines recommend purposeful, brief, precise motion and avoiding motion for its own sake, especially on frequent interactions.

Applied decision:
- Motion communicates causality/state.
- Frequent controls get minimal movement.
- No perpetual decorative motion.
- Reduce Motion is respected.

Source:
- https://developer.apple.com/design/human-interface-guidelines/motion

## Accessibility

WCAG guidance requires visible keyboard focus and adequate target size/spacing.

Applied decision:
- Visible focus throughout.
- Keyboard-operable dialogs, menus and tables.
- Target sizes/spacing suitable for mouse and touch.
- Reduced motion.
- Focus not hidden by sticky surfaces.

Sources:
- https://www.w3.org/WAI/WCAG22/Understanding/focus-visible
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html

## Responsiveness

web.dev recommends Interaction to Next Paint around 200 ms or less for a good user experience at the 75th percentile.

Applied decision:
- Keep hot interactions responsive.
- Avoid full-screen refetches for small mutations.
- Profile expensive tables/charts.
- Prefer targeted invalidation and efficient aggregation.

Source:
- https://web.dev/articles/optimize-inp

## Key synthesis

The product should not win by maximizing visible feature count.

It should win by making a very broad feature set feel **smaller than it is**:
- progressive disclosure;
- smart defaults;
- generic commands;
- batch operations;
- context-preserving sidecars;
- next-best action;
- strong recovery;
- live visual summaries;
- precise motion;
- rigorous payroll invariants.
