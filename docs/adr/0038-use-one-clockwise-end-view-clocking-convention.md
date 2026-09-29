# Use One Clockwise End-View Clocking Convention

The storefront, PI, and factory production view use one Clocking convention:
view from End A toward End B, hold End B at the 6-o'clock position as `000
degrees`, and measure End A clockwise from `000` through `359` degrees. This
explicitly resolves the incompatible clockwise and counter-clockwise conventions
found in industrial and aerospace reference material; customer drawings using a
different convention are converted before specification approval. The standard
finished-assembly Clocking Tolerance is `+/- 3 degrees`; tighter requirements
move to manual quotation and factory confirmation before PI issuance. For a
two-elbow assembly the customer must actively choose a common preset, enter a
whole-degree target, or select `Not Sure`; the configurator never silently
defaults the specification to `000 degrees`. `Not Sure` moves the line to manual
quotation, while assemblies with fewer than two angled ends do not request
Clocking.
