# Minimatch compatibility for ESLint

ESLint 9 and eslint-plugin-react consume the callable CommonJS interface exposed
by minimatch 3. This private adapter exposes that interface and forwards matching
and the `Minimatch` constructor to the pinned minimatch 11.0.1 package. All pattern
processing uses the upstream fix for GHSA-g3hv-75wg-m249.

The root overrides apply to four lint consumers. npm resolves these local paths
relative to each consumer's package directory. The root npm configuration packs
the adapter during installation. Remove these overrides and the adapter after
the lint consumers support the patched upstream interface directly.
