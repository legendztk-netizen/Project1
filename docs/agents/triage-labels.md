# Triage Labels

| Role                         | GitHub label      |
| ---------------------------- | ----------------- |
| Needs triage                 | `needs-triage`    |
| Needs information            | `needs-info`      |
| Blocked by prerequisite work | `blocked`         |
| Ready for agent work         | `ready-for-agent` |
| Ready for human work         | `ready-for-human` |
| Will not implement           | `wontfix`         |

The engineering workflow uses `ready-for-agent` for a bounded Spec or Ticket
whose prerequisites and acceptance boundary are documented.

Use `blocked` when the issue is bounded but cannot start until one or more
explicit prerequisite issues are complete. The issue body must name those
prerequisites; `blocked` and `ready-for-agent` are mutually exclusive.
