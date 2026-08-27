export const meta = {
  name: 'review-code',
  description:
    'Ad-hoc review: fan out the shared reviewer lanes (baseline + diff-matched web/server lanes + reuse + scope-fidelity + CodeRabbit CLI) on any diff — one read-only round in parallel (Sonnet), findings classified by a relevance validator, returns the aggregated report. No fix loop.',
  phases: [
    {
      title: 'Review',
      detail:
        'baseline + diff-matched web/server lanes + reuse + scope-fidelity reviewers + CodeRabbit CLI in parallel (Sonnet); a relevance validator classifies the findings',
      model: 'sonnet',
    },
  ],
};

// ── args (passed by the main session) ──────────────────────────────────────
// { inspect, context, changedFiles, addedFiles, untrackedFiles,
//   declaredAreas, coderabbitCmd, insertions, hasAcceptanceCriteria,
//   repoConfig }
// Normalised via the shared parseWorkflowArgs (hoisted from the registry block below).
const A = parseWorkflowArgs(args);
// >>> shared:repo-config-defaults — generated from the host repo's docs/agents/repo-config.md via shared/sync.sh; edit the md, then re-run sync.sh --host <repo>
// GENERATED from the host repo's docs/agents/repo-config.md ## Config block —
// edit the md, then run the plugin's shared/sync.sh. Do not edit by hand.
const REPO_CONFIG_DEFAULTS = {
  integrationBranch: 'development',
  devServerCommand:
    'DEV_LOGIN_ENABLED_SERVER=true pnpm nx portless seranote-web',
  e2eDir: 'apps/seranote-web-e2e/',
  browserGuidePath: '.claude/skills/dev-loop/browser-guide.md',
  areaPaths: {
    frontend: [
      '^libs/ui/web/',
      '^apps/seranote-web/.*\\.tsx$',
      '\\.stories\\.tsx$',
    ],
    backend: ['^libs/backend/'],
    database: [
      '^drizzle/',
      'libs/backend/db/.*schemas/',
      '/relations/',
      'drizzle\\.config\\.ts$',
    ],
    i18n: ['apps/seranote-web/src/i18n/', '^libs/shared/util/translations/'],
    security: ['^libs/backend/actions/', { re: 'auth', flags: 'i' }, '\\.env'],
  },
  goldenPaths: {
    dal: 'libs/backend/dal/notification/src/lib/notification.repo.ts',
    service:
      'libs/backend/service/prompt-output-rating/src/lib/prompt-output-rating.service.ts',
    serviceCachedRead:
      'libs/backend/service/note-snippet/src/lib/note-snippet.service.ts',
    action:
      'libs/backend/actions/prompt-output-rating/src/lib/prompt-output-rating.action.ts',
    actionSchema:
      'libs/backend/actions/prompt-output-rating/src/lib/types/schema.ts',
    schema: 'libs/backend/db/src/lib/schemas/prompt-output.schema.ts',
    relations: 'libs/backend/db/src/lib/relations/relations.ts',
    component:
      'libs/ui/web/ui/collapsible-section/src/lib/collapsible-section.tsx',
    form: 'libs/ui/web/feature/sadmin-announcement-page/src/lib/ui/sadmin-announcement-page-client.tsx',
    page: 'apps/seranote-web/src/app/(workspace)/interaction/[id]/page.tsx',
    e2e: 'apps/seranote-web-e2e/e2e/rate-prompt-output.spec.ts',
  },
  libMap: {
    'libs/static-value':
      '@vtt/static-value — cross-cutting enums, constants and feature-flag keys (app modules, certificate types, cookies, banner variants, product lookup keys)',
    'libs/backend/db':
      '@vtt/backend-db — drizzle client + all pg table schemas, enums and relations; single source of DB types',
    'libs/backend/analytics-db':
      '@vtt/backend-analytics-db — separate analytics postgres client, schema and interaction-sync job',
    'libs/backend/providers':
      '@vtt/backend-providers — NextAuth auth options and auth providers (MitID, dev credentials)',
    'libs/backend/email':
      '@vtt/backend-email — transactional email sending service',
    'libs/backend/email-templates':
      '@vtt/backend-email-templates — react-email templates + render/display-name helpers',
    'libs/backend/sms':
      '@vtt/backend-sms — SMS sending service (phone verification)',
    'libs/backend/s3':
      '@vtt/backend-s3 — S3 client and object key prefix helpers',
    'libs/backend/transcription-ws':
      '@vtt/backend-transcription-ws — real-time transcription WebSocket pipeline attached to the seranote-web custom server',
    'libs/backend/ai/prompt':
      '@vtt/backend-ai-prompt — LLM prompt constructors (SOAP, LÆ125, summary, certificate) and AI/prompt services',
    'libs/backend/data-access/posthog':
      '@vtt/backend-data-access-posthog — server-side PostHog client and feature-flag reads',
    'libs/backend/data-access/server-session':
      '@vtt/backend-server-session — server session lookup and permission checks',
    'libs/backend/data-access/stripe':
      '@vtt/backend-data-access-stripe — Stripe SDK client and customer helpers',
    'libs/backend/util/action':
      '@vtt/backend-util-action — withServerAction wrapper (Sentry span + exception capture) for every server action',
    'libs/backend/util/api-auth':
      '@vtt/backend-util-api-auth — bearer/API-key auth for partner API route handlers',
    'libs/backend/util/logger':
      '@vtt/backend-util-logger — structured server logger',
    'libs/backend/util/prompt-response':
      '@vtt/backend-util-prompt-response (+/client) — parse/normalise LLM markdown output into document-content structures',
    'libs/backend/util/transcription-session':
      '@vtt/backend-util-transcription-session — transcription session state helpers',
    'libs/backend/dal/<entity>':
      'one @vtt/backend-dal-<entity> repo lib per table, built on createBaseRepo from libs/backend/dal/base — entities mirror the schemas in libs/backend/db (interaction, transcription, prompt-output, user, subscription, license-*, note-*, patient-inquiry-*, …); check for an existing repo before writing a query elsewhere',
    'libs/backend/service/context':
      '@vtt/backend-service-context/server — getServiceContext()/requirePermission(): the auth gate every service calls first',
    'libs/backend/service/<entity>':
      'one @vtt/backend-service-<entity>/server business-logic lib per entity (auth, audit, cache, repo calls) — ~30 exist (interaction, subscription, signup, transcription, user-product, summary-context, …); check before adding logic to an action',
    'libs/backend/actions/<entity>':
      'one @vtt/backend-action-<entity> server-action lib per entity (zod validate + delegate) — note-snippet and prompt-output-rating are the clean exemplars; certificate-context, interaction, transcription, prompt-output and user are bundled ANTI-PATTERNS (no/thin service twin) — do not mirror them',
    'libs/shared/util/api-dtos':
      '@vtt/util-api-dtos — shared zod DTOs and brand/pagination/prompt-template option types',
    'libs/shared/util/api-openapi':
      '@vtt/util-api-openapi — zod-to-OpenAPI registry, security schemes and spec builder for the partner API',
    'libs/shared/util/assets':
      '@vtt/util-assets — asset lookups (country flag map)',
    'libs/shared/util/csv': '@vtt/util-csv — CSV serialisation helper',
    'libs/shared/util/date':
      '@vtt/util-date — date/day-bounds/trial-day helpers',
    'libs/shared/util/discount':
      '@vtt/util-discount — discount label formatting',
    'libs/shared/util/invoice': '@vtt/util-invoice — invoice proration maths',
    'libs/shared/util/locale-format':
      '@vtt/util-locale-format — currency/datetime formatting and language-ISO→locale map',
    'libs/shared/util/supported-languages':
      '@vtt/util-supported-languages — supported UI/transcription language list',
    'libs/shared/util/translations':
      '@vtt/util-translations — generated next-intl message key types + assertion helpers',
    'libs/shared/util/user':
      '@vtt/util-user — user helpers (email recipient resolution)',
    'libs/ui/web/util/classname':
      '@vtt/util-classname — cn() tailwind class merge helper',
    'libs/ui/web/util/admin-pages-registry':
      '@vtt/web-util-admin-pages-registry — registry of admin/sadmin page routes',
    'libs/ui/web/util/auth-token':
      '@vtt/web-util-auth-token — client auth token access and storage',
    'libs/ui/web/util/copy-to-clipboard':
      '@vtt/web-util-copy-to-clipboard — useCopyToClipboard hook',
    'libs/ui/web/util/is-mobile':
      '@vtt/web-util-is-mobile — mobile viewport detection hook',
    'libs/ui/web/util/locale':
      '@vtt/web-util-locale/server — server-side locale resolution for next-intl',
    'libs/ui/web/util/prompt-blueprints':
      '@vtt/web-util-prompt-blueprints — prompt blueprint lookup and follow-up copy-text building',
    'libs/ui/web/util/search-replace':
      '@vtt/web-util-search-replace — text search/replace utility for editors',
    'libs/ui/web/util/shared-license-dialog-cookie':
      '@vtt/web-util-shared-license-dialog-cookie — cookie for suppressing the shared-license dialog',
    'libs/ui/web/util/string-processing':
      '@vtt/web-util-string-processing — chunking, empty-line removal, segment length, placeholder stripping',
    'libs/ui/web/ui/alert-dialog':
      '@vtt/web-ui-alert-dialog — radix alert dialog primitives',
    'libs/ui/web/ui/badge': '@vtt/web-ui-badge — badge component',
    'libs/ui/web/ui/banner': '@vtt/web-ui-banner — page-level banner component',
    'libs/ui/web/ui/button':
      '@vtt/web-ui-button — button + cva variants, copy-button, two-state button',
    'libs/ui/web/ui/calendar':
      '@vtt/web-ui-calendar — react-day-picker calendar',
    'libs/ui/web/ui/card': '@vtt/web-ui-card — card container primitives',
    'libs/ui/web/ui/chart':
      '@vtt/web-ui-chart — recharts wrapper with themed container/tooltip/legend',
    'libs/ui/web/ui/checkbox': '@vtt/web-ui-checkbox — checkbox',
    'libs/ui/web/ui/collapsible':
      '@vtt/web-ui-collapsible — radix collapsible primitives',
    'libs/ui/web/ui/collapsible-section':
      '@vtt/web-ui-collapsible-section — labelled expand/collapse section with icon header',
    'libs/ui/web/ui/combobox':
      '@vtt/web-ui-combobox — searchable select combobox',
    'libs/ui/web/ui/data-table':
      '@vtt/web-ui-data-table — tanstack-table data table with sorting/selection',
    'libs/ui/web/ui/date-picker':
      '@vtt/web-ui-date-picker — popover date picker',
    'libs/ui/web/ui/dialog': '@vtt/web-ui-dialog — radix dialog primitives',
    'libs/ui/web/ui/discount-tag':
      '@vtt/web-ui-discount-tag — discount label tag',
    'libs/ui/web/ui/drawer': '@vtt/web-ui-drawer — vaul drawer',
    'libs/ui/web/ui/dropdown-menu':
      '@vtt/web-ui-dropdown-menu — radix dropdown menu primitives',
    'libs/ui/web/ui/editable-title':
      '@vtt/web-ui-editable-title — inline-editable title field',
    'libs/ui/web/ui/empty-state':
      '@vtt/web-ui-empty-state — icon + title + subtitle + action empty state',
    'libs/ui/web/ui/faded-scroll-view':
      '@vtt/web-ui-faded-scroll-view — scroll container with edge fade masks',
    'libs/ui/web/ui/form':
      '@vtt/web-ui-form — react-hook-form field/label/message wrappers',
    'libs/ui/web/ui/input': '@vtt/web-ui-input — text input',
    'libs/ui/web/ui/input-otp': '@vtt/web-ui-input-otp — OTP code input',
    'libs/ui/web/ui/input-phone':
      '@vtt/web-ui-input-phone — international phone input with country select',
    'libs/ui/web/ui/label': '@vtt/web-ui-label — form label',
    'libs/ui/web/ui/license-status':
      '@vtt/web-ui-license-status — license status pill',
    'libs/ui/web/ui/link-card': '@vtt/web-ui-link-card — clickable card link',
    'libs/ui/web/ui/loading-spinner': '@vtt/web-ui-loading-spinner — spinner',
    'libs/ui/web/ui/message-card':
      '@vtt/web-ui-message-card — informational message card',
    'libs/ui/web/ui/page-header':
      '@vtt/web-ui-page-header — page title/action header',
    'libs/ui/web/ui/page-section':
      '@vtt/web-ui-page-section — page section wrapper',
    'libs/ui/web/ui/pagination': '@vtt/web-ui-pagination — pagination controls',
    'libs/ui/web/ui/popover': '@vtt/web-ui-popover — radix popover primitives',
    'libs/ui/web/ui/radio-group': '@vtt/web-ui-radio-group — radio group',
    'libs/ui/web/ui/section-textarea':
      '@vtt/web-ui-section-textarea — section-scoped textarea for generated documents',
    'libs/ui/web/ui/select': '@vtt/web-ui-select — radix select',
    'libs/ui/web/ui/separator': '@vtt/web-ui-separator — separator rule',
    'libs/ui/web/ui/sheet': '@vtt/web-ui-sheet — side sheet',
    'libs/ui/web/ui/sidebar': '@vtt/web-ui-sidebar — sidebar shell primitives',
    'libs/ui/web/ui/signup-step-indicator':
      '@vtt/web-ui-signup-step-indicator — signup progress step indicator',
    'libs/ui/web/ui/skeleton': '@vtt/web-ui-skeleton — loading skeleton',
    'libs/ui/web/ui/sonner': '@vtt/web-ui-sonner — toast host (sonner)',
    'libs/ui/web/ui/status-addition':
      '@vtt/web-ui-status-addition — status/addition chips for interactions',
    'libs/ui/web/ui/step-dots-indicator':
      '@vtt/web-ui-step-dots-indicator — dot step indicator',
    'libs/ui/web/ui/stepper': '@vtt/web-ui-stepper — multi-step stepper',
    'libs/ui/web/ui/subscription-date':
      '@vtt/web-ui-subscription-date — subscription date display',
    'libs/ui/web/ui/switch': '@vtt/web-ui-switch — toggle switch',
    'libs/ui/web/ui/table': '@vtt/web-ui-table — table primitives',
    'libs/ui/web/ui/tabs': '@vtt/web-ui-tabs — radix tabs',
    'libs/ui/web/ui/text-entries':
      '@vtt/web-ui-text-entries — editable list of text entries',
    'libs/ui/web/ui/textarea':
      '@vtt/web-ui-textarea — textarea + section heading',
    'libs/ui/web/ui/tile': '@vtt/web-ui-tile — selectable tile',
    'libs/ui/web/ui/toggle': '@vtt/web-ui-toggle — toggle button',
    'libs/ui/web/ui/toggle-group':
      '@vtt/web-ui-toggle-group — toggle button group',
    'libs/ui/web/ui/tooltip': '@vtt/web-ui-tooltip — radix tooltip',
    'libs/ui/web/prototype':
      '@vtt/web-prototype — Storybook-only UI prototypes (barrel intentionally empty)',
    'libs/ui/web/feature/account-page':
      '@vtt/web-feature-account-page — user account page and its actions',
    'libs/ui/web/feature/announcement-banner':
      '@vtt/web-feature-announcement-banner/server — server-rendered global announcement banner',
    'libs/ui/web/feature/audio-context':
      '@vtt/web-feature-audio-context — mic/audio session context, document-generation and inline-dictation hooks, audio quality signals',
    'libs/ui/web/feature/branding':
      '@vtt/web-feature-branding — logo, support contact and website link components',
    'libs/ui/web/feature/checkout-success-page':
      '@vtt/web-feature-checkout-success-page — post-Stripe-checkout success page',
    'libs/ui/web/feature/claim-admin-page':
      '@vtt/web-feature-claim-admin-page — claim-org-admin signup page',
    'libs/ui/web/feature/consultations-page':
      '@vtt/web-feature-consultations-page — consultations list page',
    'libs/ui/web/feature/consultations-panel':
      '@vtt/web-feature-consultations-panel — consultations side panel',
    'libs/ui/web/feature/create-account-page':
      '@vtt/web-feature-create-account-page — account creation signup step',
    'libs/ui/web/feature/dba-page':
      '@vtt/web-feature-dba-page — data-processing-agreement signing page',
    'libs/ui/web/feature/diagnosis-code-picker':
      '@vtt/web-feature-diagnosis-code-picker — diagnosis code search/picker and badges',
    'libs/ui/web/feature/dictation-textarea':
      '@vtt/web-feature-dictation-textarea — textarea with inline voice dictation + section field variant',
    'libs/ui/web/feature/email-verification-reminder':
      '@vtt/web-feature-email-verification-reminder — nag handler for unverified email',
    'libs/ui/web/feature/free-trial-handler':
      '@vtt/web-feature-free-trial-handler — free-trial start/expiry dialog handler',
    'libs/ui/web/feature/global-store':
      '@vtt/web-feature-global-store — zustand global client store',
    'libs/ui/web/feature/impact-analysis-page':
      '@vtt/web-feature-impact-analysis-page — impact analysis page',
    'libs/ui/web/feature/interaction-doc-workspace':
      '@vtt/web-feature-interaction-doc-workspace (+/autosave) — config-driven document workspace engine (sections, doc list, autosave hooks)',
    'libs/ui/web/feature/interaction-notes':
      '@vtt/web-feature-interaction-notes — note module UI and right pane',
    'libs/ui/web/feature/interaction-page':
      '@vtt/web-feature-interaction-page — main consultation/interaction workspace page',
    'libs/ui/web/feature/interaction-referrals':
      '@vtt/web-feature-interaction-referrals — referral module pages, settings and output panes',
    'libs/ui/web/feature/landing-page':
      '@vtt/web-feature-landing-page — post-login landing page with the start-interaction form',
    'libs/ui/web/feature/live-transcription':
      '@vtt/web-feature-live-transcription — live transcription streaming UI',
    'libs/ui/web/feature/login-page':
      '@vtt/web-feature-login-page — login and login-error pages (incl. dev login panel)',
    'libs/ui/web/feature/onboarding':
      '@vtt/web-feature-onboarding — first-run onboarding flow',
    'libs/ui/web/feature/organisation-setup-page':
      '@vtt/web-feature-organisation-setup-page — organisation setup signup step + actions',
    'libs/ui/web/feature/patient-inquiry-page':
      '@vtt/web-feature-patient-inquiry-page — patient inquiry module landing, interaction page and snippet editor',
    'libs/ui/web/feature/patient-note-dialog':
      '@vtt/web-feature-patient-note-dialog — patient-facing note generation dialog',
    'libs/ui/web/feature/prompt-output-rating':
      '@vtt/web-feature-prompt-output-rating — thumbs up/down + feedback widget on generated documents',
    'libs/ui/web/feature/recording-indicator':
      '@vtt/web-feature-recording-indicator — global recording status indicator',
    'libs/ui/web/feature/resizable-panel':
      '@vtt/web-feature-resizable-panel — resizable split layout and provider',
    'libs/ui/web/feature/rich-text':
      '@vtt/web-feature-rich-text — rich text editor component',
    'libs/ui/web/feature/sadmin-announcement-page':
      '@vtt/web-feature-sadmin-announcement-page — sadmin announcement editor (react-hook-form + zodResolver)',
    'libs/ui/web/feature/sadmin-organisations-page':
      '@vtt/web-feature-sadmin-organisations-page — sadmin organisations list',
    'libs/ui/web/feature/sadmin-ratings-page':
      '@vtt/web-feature-sadmin-ratings-page — sadmin rating dashboard and explore pages',
    'libs/ui/web/feature/sadmin-test-email-page':
      '@vtt/web-feature-sadmin-test-email-page — sadmin email template test harness',
    'libs/ui/web/feature/sadmin-users-page':
      '@vtt/web-feature-sadmin-users-page — sadmin users list',
    'libs/ui/web/feature/session-context':
      '@vtt/web-feature-session-context — session lifecycle: preference init, inactivity handler/page, post-login page, Sentry user sync',
    'libs/ui/web/feature/settings-page':
      '@vtt/web-feature-settings-page — user settings page',
    'libs/ui/web/feature/shared-license-handler':
      '@vtt/web-feature-shared-license-handler — shared license claim handler and picker modal',
    'libs/ui/web/feature/sidebar':
      '@vtt/web-feature-sidebar (+/server) — app sidebar; server entry renders it, client entry exposes pin hooks/dialog',
    'libs/ui/web/feature/signup-cookies':
      '@vtt/web-feature-signup-cookies (+/server) — signup progress cookie read/write',
    'libs/ui/web/feature/signup-step-indicator-overlay':
      '@vtt/web-feature-signup-step-indicator-overlay — route-aware signup step overlay + sub-step dots',
    'libs/ui/web/feature/subscription-management-page':
      '@vtt/web-feature-subscription-management-page — org subscription/seat management page',
    'libs/ui/web/feature/summary-page':
      '@vtt/web-feature-summary-page — patient summary module landing and interaction pages',
    'libs/ui/web/feature/terms-page':
      '@vtt/web-feature-terms-page — terms acceptance signup step',
    'libs/ui/web/feature/tool-module-shell':
      '@vtt/web-feature-tool-module-shell — shared shell for tool modules (layout, setup/output panels, reset alert, empty state)',
    'libs/ui/web/feature/transcription-buttons':
      '@vtt/web-feature-transcription-buttons — record/stop/regenerate controls + regenerate alert',
    'libs/ui/web/feature/user-management-page':
      '@vtt/web-feature-user-management-page — org admin user/license management page and user detail drawer form',
    'libs/ui/web/feature/verify-email-page':
      '@vtt/web-feature-verify-email-page — email verification landing page',
    'libs/ui/web/feature/verify-mailbox':
      '@vtt/web-feature-verify-mailbox — mailbox verification prompt component',
    'libs/ui/web/feature/welcome-back-handler':
      '@vtt/web-feature-welcome-back-handler — returning-user welcome-back dialog handler',
  },
};
// <<< shared:repo-config-defaults
const CFG = A.repoConfig || {}; // from docs/agents/repo-config.md
// How reviewers see the code under review — a command plus any caveats,
// e.g. "git diff development...HEAD" or "git diff HEAD (uncommitted changes)".
const INSPECT = A.inspect
  ? String(A.inspect)
  : 'git diff HEAD  # uncommitted changes vs HEAD';
const CONTEXT = A.context ? String(A.context) : '';
// The exact CodeRabbit CLI invocation matching the inspect mode (built by the
// skill's Step 1); empty/absent = skip the CodeRabbit reviewer (e.g. a PR
// reviewed diff-only with no local checkout for the CLI to run against).
const CODERABBIT_CMD = A.coderabbitCmd ? String(A.coderabbitCmd) : '';
// Inserted-line count from the skill's Step 1 (`git diff --shortstat`) — gates
// the scope-fidelity lane together with added files.
const INSERTIONS = Number(A.insertions) || 0;
// True only when the context carries real acceptance criteria — the
// scope-fidelity lane needs a frozen AC to justify against; a bare context
// string ("pre-commit check") is not a necessity bar.
const HAS_AC = A.hasAcceptanceCriteria === true;
const LIB_MAP = buildLibMap(CFG);

// >>> shared:reviewer-registry — generated from the host repo's .claude/skills/_shared/reviewer-registry.js; edit there and run shared/sync.sh --host <repo>
// Shared reviewer registry for the feature-dev workflow scripts. Those scripts
// ship in the private `magnus` plugin (magnuskeinicke/agent-plugins), not here;
// this file is the repo-specific input they consume, because the lanes name
// THIS repo's domain skills and paths.
//
// Workflow scripts must be self-contained — they cannot import this file — so
// the plugin's `shared/sync.sh --host <this repo>` copies it verbatim into each
// target between the `// >>> shared:reviewer-registry` /
// `// <<< shared:reviewer-registry` markers (`--check` fails on drift). Edit
// HERE, never in the generated blocks. Plugin-side targets: work-slice-loop,
// review-code, iterate-pr, solve-ready-loop.
// Assumes the `shared:repo-config-defaults` block (REPO_CONFIG_DEFAULTS,
// generated from docs/agents/repo-config.md) appears ABOVE this block in
// every target — sync.sh maintains both.

// Runtime quirk: the Workflow runtime can deliver `args` as a JSON *string*.
function parseWorkflowArgs(raw) {
  let a = raw || {};
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a);
    } catch {
      a = {};
    }
  }
  return a || {};
}

function buildLibMap(cfg) {
  const map = cfg.libMap || REPO_CONFIG_DEFAULTS.libMap;
  return map
    ? Object.entries(map)
        .map(([lib, purpose]) => `- ${lib}: ${purpose}`)
        .join('\n')
    : '';
}

const KNOWN_AREAS = [
  'frontend',
  'backend',
  'database',
  'i18n',
  'security',
  'performance',
];

const REVIEWERS = {
  frontend: {
    skills:
      'frontend-implementation, tailwind-predefined-values, web-design-guidelines, figma-implement-design',
    focus:
      'React component structure, design-system token/component reuse (no magic numbers), Tailwind predefined values + cn() for conditionals, loading/empty/error states, Web Interface Guidelines (a11y).',
  },
  backend: {
    skills: 'backend-action-service-split',
    focus:
      'the dal/service/action three-layer split, server-action boundaries, cache invalidation, error-as-value (return error objects, never throw), createBaseRepo usage. Plus server performance: N+1 query patterns, sequential awaits where Promise.all fits, over-fetching, query volume on hot paths.',
  },
  database: {
    skills: 'CLAUDE.md DB conventions',
    focus:
      'Drizzle schema/relations correctness, migration generated + sequenced correctly (not hand-renumbered), createBaseRepo query patterns, no OUTER JOINs (prefer INNER or correlated scalar subqueries). Plus query performance: indexes matching new query patterns, join/subquery cost on large tables.',
  },
  i18n: {
    skills: 'i18n',
    focus:
      'every t()/useTranslations/getTranslations key exists in the generated type source (libs/shared/util/translations messages.ts — there is NO en.json in this repo), ICU placeholders/plural/select valid, Crowdin key naming, no hardcoded user-facing strings.',
  },
  security: {
    skills: 'security-review',
    focus:
      'authorization on server actions, secret/env handling, input validation, injection, file-upload safety, no secret leakage into client bundles.',
  },
  // client/React lens only — server-side performance lives in backend/database focus above.
  performance: {
    skills: 'vercel-react-best-practices',
    focus:
      'data-fetching waterfalls, unnecessary client components, memoization, bundle/dynamic-import, render cost on hot paths.',
  },
};

const BASELINE = {
  skills: 'CLAUDE.md conventions',
  focus:
    'correctness bugs, missed acceptance criteria, convention/reuse misses, and test quality — NOT style nits. Comment hygiene IS in scope (CLAUDE.md comment rules, not a style nit): flag comments that restate the code, narrate the change, or compensate for an unclear name — the fix is deleting the comment or renaming so the code self-documents; a comment that survives states a non-obvious why in one line. Dead code and leftovers are in scope too: commented-out code, unused exports/params/variables, stray console.log/debug artifacts, and code orphaned by the change itself.',
};

// The reuse/consolidation reviewer — always its own agent, gated on the diff
// adding OR modifying files. Duplicate-of-existing-lib = BLOCKING; generalizable-new-code =
// `consolidations` (filed as follow-up tickets, never blocking). The provenance
// audit is a separate field so ad-hoc reviews (no provenance table) can omit it.
const REUSE = {
  skills: 'CLAUDE.md conventions',
  focus:
    'every function/component/hook/util/type ADDED by the diff — in new files OR added to modified files: search libs/** and the design system for an existing equivalent BEFORE accepting it (use repoConfig.libMap as the search index when provided). An equivalent exists → BLOCKING finding: use it and delete the copy. New code that is genuinely generalizable → a `consolidations` entry naming the target lib — NOT a blocking finding. Also DRY within the change itself (added AND modified files): the same logic/markup/query shape repeated across the diff → BLOCKING when a small local helper/component would remove it, a `consolidations` entry when the extraction is big enough to be follow-up work. Only flag real duplication (same reason to change) — never force an abstraction over incidental similarity. Also YAGNI/speculative abstraction: options/params/config no call site passes, wrapper layers with a single caller, generality no current caller needs → BLOCKING when the fix is inlining/deleting the speculation; a note when debatable.',
  provenanceFocus:
    "Also audit the implementer's provenance table: every added file must cite a real `mirroredFrom` exemplar (verify it exists and is actually mirrored) or an explicit `deviation` reason — a missing, false, or hand-wavy row is a BLOCKING finding.",
};

// The CodeRabbit reviewer — wraps the CodeRabbit CLI (`coderabbit review
// --agent`) as one extra reviewer agent. It runs ONCE per workflow run, in the
// FIRST reviewer round only (rate-limited external service; one round of
// external signal is enough) — fix rounds re-run only our own lanes. The
// wrapper agent verifies CodeRabbit's findings against the actual code before
// reporting, so hallucinated or stale findings don't enter the fix loop.
function coderabbitPrompt(contractText, crCmd) {
  return `You are the CodeRabbit reviewer for this change — a READ-ONLY wrapper around the CodeRabbit CLI. You MUST NOT edit any files — only report.

${contractText}

Run the CodeRabbit CLI review via Bash (long-running — use a generous timeout, up to 10 minutes):
\`${crCmd}\`

Then translate its output into the structured report:
- VERIFY each CodeRabbit finding against the actual code (open the cited file/line) before reporting it — drop anything that does not hold up.
- blockingFindings: verified correctness bugs, security vulnerabilities, data-loss/race/resource-leak risks, or broken error handling. Each with title, file, line, detail, and a concrete suggestedFix.
- notes: style/naming/docs/nit-level suggestions worth a human glance — never blocking.
- If the CLI is missing, unauthenticated, rate-limited, or errors out: return an empty blockingFindings array plus a single note "CodeRabbit CLI unavailable: <reason>". Do NOT fall back to reviewing the code yourself — the other reviewer lanes cover that.
Set "area" to "coderabbit". Do not pad findings to look productive — empty arrays are the correct result for a clean run.`;
}

// area → path patterns (regex sources; object form `{re, flags}` carries flags).
// Overridable per run via `repoConfig.areaPaths`; the default comes straight
// from docs/agents/repo-config.md via the generated repo-config-defaults block.
const DEFAULT_AREA_PATHS = REPO_CONFIG_DEFAULTS.areaPaths;

function compileAreaPaths(map) {
  return Object.entries(map || {}).map(([area, patterns]) => [
    area,
    (patterns || []).map((p) =>
      typeof p === 'string' ? new RegExp(p) : new RegExp(p.re, p.flags || ''),
    ),
  ]);
}

// deterministic path → area mapping, unioned with agent-declared areas
function selectAreas(compiledAreaPaths, changedFiles, declaredAreas) {
  const set = new Set();
  for (const f of changedFiles || [])
    for (const [area, regexes] of compiledAreaPaths)
      if (regexes.some((r) => r.test(f))) set.add(area);
  for (const a of declaredAreas || []) if (KNOWN_AREAS.includes(a)) set.add(a);
  return [...set];
}

// Triggered areas group into two composite review LANES (at most baseline + 2
// reviewers per round); a lane's prompt merges its triggered members' skills + focus.
const AREA_LANES = {
  frontend: 'web',
  i18n: 'web',
  performance: 'web',
  backend: 'server',
  database: 'server',
  security: 'server',
};

// Defensive enrichment: frontend always pulls the performance lens, backend
// always pulls security (those two areas rarely trigger by path alone).
function groupAreasByLane(areas) {
  const set = new Set(areas);
  if (set.has('frontend')) set.add('performance');
  if (set.has('backend')) set.add('security');
  const lanes = {};
  for (const a of set) {
    const lane = AREA_LANES[a];
    if (!lane) continue;
    (lanes[lane] = lanes[lane] || []).push(a);
  }
  return Object.entries(lanes);
}

// composite reviewer def for a lane's triggered member areas
function laneDef(memberAreas) {
  return {
    skills: [
      ...new Set(memberAreas.flatMap((a) => REVIEWERS[a].skills.split(', '))),
    ].join(', '),
    focus: memberAreas.map((a) => `\n- ${a}: ${REVIEWERS[a].focus}`).join(''),
  };
}

const FINDING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    file: { type: 'string' },
    line: { type: 'number' },
    detail: { type: 'string' },
    suggestedFix: { type: 'string' },
    rootCause: {
      type: 'string',
      description:
        'Short slug naming the underlying cause (what is wrong, not where) — powers the cross-round finding identity, so keep it stable across re-raises.',
    },
  },
  required: ['title', 'detail'],
};

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    area: { type: 'string' },
    blockingFindings: { type: 'array', items: FINDING },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Judgement-call / debatable points; never block.',
    },
    consolidations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          detail: {
            type: 'string',
            description:
              'What is generalizable, and which existing call sites would adopt it.',
          },
          targetLib: {
            type: 'string',
            description:
              'The existing lib the code should be consolidated into.',
          },
        },
        required: ['title', 'detail'],
      },
      description:
        'Reuse reviewer only: generalizable-new-code that belongs in an existing lib as FOLLOW-UP work. Never blocking — the orchestrator files these as tickets, keeping the slice diff small.',
    },
  },
  required: ['area', 'blockingFindings', 'notes'],
};

// ── Review economics: ledger, validator, debt score, adjudicator, scope lane ──
// Inspired by kramme-cc-workflow (MIT) —
// https://github.com/Abildtoft/kramme-cc-workflow
//
// One ledger per workflow run. Every validated finding gets a stable `CR-NNN`
// id (monotonic, never recycled), a fingerprint (reviewer lane + file + root
// cause — never line numbers, lines shift across fix commits), and a lifecycle
// status: open | addressed | deferred | disputed | dropped. `addressed`
// records the fix commit hash; disputed/deferred fingerprints auto-suppress
// re-raises; dropped repeats stay visible and are re-validated.

const LEDGER_WEIGHTS = { blocking: 4, suggestion: 1, advisory: 0.25 };
// Two consecutive reviewer rounds without material progress → stop (stalled).
const LEDGER_STALL_LIMIT = 2;
// A fingerprint that survives this many fix attempts is deferred, not re-targeted.
const LEDGER_DEFER_ATTEMPTS = 2;
// Hard round cap — a safety boundary, not a target; the debt-score stop
// conditions are expected to end the loop first.
const LEDGER_HARD_CAP = 5;

function createLedger() {
  return { entries: [], nextId: 1 };
}

function findingFingerprint(area, f) {
  const cause = String(f.rootCause || f.title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `${area}|${f.file || '?'}|${cause}`;
}

// Auto-suppression: a re-raised finding whose fingerprint matches a disputed or
// deferred entry never re-enters the round and never scores.
function ledgerSuppress(ledger, findings) {
  const kept = [];
  const suppressed = [];
  for (const f of findings) {
    const fp = findingFingerprint(f.area, f);
    const hit = ledger.entries.find(
      (e) =>
        e.fingerprint === fp &&
        (e.status === 'disputed' || e.status === 'deferred'),
    );
    (hit ? suppressed : kept).push(f);
  }
  return { kept, suppressed };
}

// Route one round's validated findings into the ledger. `validated` rows are
// { finding (carrying .area and a round-local .id), cls, confidence,
// diffCaused } from classifyFindings. Returns the open blocking entries this
// round should fix.
function ledgerIngest(ledger, round, validated) {
  for (const v of validated) {
    const f = v.finding;
    const fp = findingFingerprint(f.area, f);
    const existing = ledger.entries.find((e) => e.fingerprint === fp);
    if (!existing) {
      ledger.entries.push({
        id: `CR-${String(ledger.nextId++).padStart(3, '0')}`,
        fingerprint: fp,
        area: f.area,
        title: f.title,
        file: f.file,
        line: f.line,
        detail: f.detail,
        suggestedFix: f.suggestedFix,
        round,
        severity: v.cls === 'eligible' ? 'blocking' : 'advisory',
        status: v.cls === 'dropped' ? 'dropped' : 'open',
        confidence: v.confidence,
        diffCaused: v.diffCaused,
        fixAttempts: 0,
      });
      continue;
    }
    if (existing.status === 'disputed' || existing.status === 'deferred')
      continue; // suppressed upstream; belt-and-braces
    if (existing.status === 'open') {
      existing.line = f.line ?? existing.line;
      continue;
    }
    if (v.cls === 'dropped') continue; // unverified re-raise never reopens
    if (existing.status === 'addressed') {
      // Re-raised after a fix: the same CR id reopens — unless the fingerprint
      // already survived LEDGER_DEFER_ATTEMPTS fix attempts, then it is
      // deferred and stops being targeted.
      if ((existing.fixAttempts || 0) >= LEDGER_DEFER_ATTEMPTS) {
        existing.status = 'deferred';
        continue;
      }
    }
    // addressed (re-raised) or dropped (now verified): reopen/revive
    existing.status = 'open';
    existing.severity = v.cls === 'eligible' ? 'blocking' : 'advisory';
    existing.confidence = v.confidence;
    existing.diffCaused = v.diffCaused;
    existing.detail = f.detail || existing.detail;
    existing.line = f.line ?? existing.line;
  }
  return ledgerOpenBlocking(ledger);
}

function ledgerOpenBlocking(ledger) {
  return ledger.entries.filter(
    (e) => e.status === 'open' && e.severity === 'blocking',
  );
}

function ledgerScore(ledger) {
  let s = 0;
  for (const e of ledger.entries)
    if (e.status === 'open') s += LEDGER_WEIGHTS[e.severity] ?? 1;
  return s;
}

// Material progress: the debt score dropped ≥1, an open blocking finding died,
// or a previously-failing gate (tests/commit) cleared. Measured after each
// reviewer round's ingest; anything else is a stalled round.
function ledgerProgress(prev, ledger, gateCleared) {
  const score = ledgerScore(ledger);
  const openIds = new Set(ledgerOpenBlocking(ledger).map((e) => e.id));
  const progressed =
    !prev ||
    gateCleared ||
    prev.score - score >= 1 ||
    [...prev.openIds].some((id) => !openIds.has(id));
  return { progressed, snapshot: { score, openIds } };
}

// Verdict language used everywhere the loop result is reported (workflow
// return, PR comment, magnus:babysit-stack input): `converged`, or an explicit
// stalled verdict naming what shipped unresolved — never a silently
// exhausted cap.
function ledgerVerdict(ledger, converged) {
  if (converged) return 'converged';
  const open = ledgerOpenBlocking(ledger);
  return open.length
    ? `stalled — shipped with ${open.length} open finding(s) (${open
        .map((e) => e.id)
        .join(', ')})`
    : 'stalled — no open findings, but the loop could not verify convergence';
}

// Feedback/finding view of a ledger entry — feeds fmtFeedback and `outstanding`.
function ledgerEntryFinding(e) {
  return {
    id: e.id,
    area: e.area,
    title: e.title,
    file: e.file,
    line: e.line,
    detail: e.detail,
    suggestedFix: e.suggestedFix,
  };
}

// Mark a fix pass's outcome on the entries it targeted. `addressed` requires
// the fix commit hash; disputes carry the implementer's evidence for the
// closeout adjudicator.
function ledgerApplyFix(targets, fix) {
  const disputed = fix.disputed || [];
  const ids = new Set(disputed.map((d) => d.id).filter(Boolean));
  const titles = new Set(disputed.map((d) => d.title));
  for (const e of targets) {
    e.fixAttempts = (e.fixAttempts || 0) + 1;
    if (ids.has(e.id) || titles.has(e.title)) {
      e.status = 'disputed';
      const d = disputed.find((x) => x.id === e.id || x.title === e.title);
      e.disputeEvidence = d ? d.evidence : '';
    } else {
      e.status = 'addressed';
      e.fixCommit = fix.head || '';
    }
  }
}

// Cross-round memory injected into every reviewer prompt from round 2 on.
function ledgerHistoryText(ledger) {
  if (!ledger.entries.length) return '';
  const lines = ledger.entries
    .map((e) => `- ${e.id} [${e.status}] (${e.area}) ${e.title}`)
    .join('\n');
  return `

Finding ledger from prior rounds (stable ids, statuses shown):
${lines}
- "addressed": verify the fix where it falls in your focus — re-raise ONLY if it is demonstrably wrong or incomplete (a re-raise reopens the same id).
- "disputed" / "deferred": do NOT re-raise — re-raises are auto-suppressed (disputed goes to the human on the PR; deferred survived ${LEDGER_DEFER_ATTEMPTS} fix attempts and is out of loop scope).
- "dropped": judged unverified by the relevance gate — re-raise only with concrete NEW evidence (file:line proof).
Beyond that, report only NEW problems introduced by the fix diff. Do not sweep for fresh nitpicks in code that already passed earlier rounds.`;
}

// Ledger block for the final PR comment / report: exactly what survived, by
// status, so the human review surface shows the whole story.
function ledgerReport(ledger) {
  const fmt = (e) =>
    `- ${e.id} [${e.status}] (${e.area}) ${e.title}${e.file ? ` — ${e.file}` : ''}${
      e.disputeEvidence ? `\n  dispute evidence: ${e.disputeEvidence}` : ''
    }${e.ruling ? `\n  adjudicated: ${e.ruling}` : ''}`;
  const open = ledger.entries.filter((e) => e.status === 'open');
  const rest = ledger.entries.filter(
    (e) => e.status === 'deferred' || e.status === 'disputed',
  );
  if (!open.length && !rest.length) return '';
  return [
    open.length ? `Open:\n${open.map(fmt).join('\n')}` : '',
    rest.length ? `Deferred / disputed:\n${rest.map(fmt).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// Shared feedback formatter for fix-pass prompts and validator input.
function fmtFeedback(blocking) {
  return blocking
    .map(
      (f, i) =>
        `${i + 1}. ${f.id ? `[id: ${f.id}] ` : ''}[${f.area}] ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}\n   ${f.detail}${f.suggestedFix ? `\n   Suggested fix: ${f.suggestedFix}` : ''}`,
    )
    .join('\n');
}

// ── Relevance + confidence validator (post-aggregation, pre-fix) ─────────────
// One Sonnet agent per round classifies the raw findings before any fix pass:
// (a) caused by this diff or pre-existing/out-of-scope, (b) confidence 0–100
// that the finding is real and correctly located. It classifies — it may NOT
// add findings of its own.

const VALIDATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description:
              'The [id] tag of the finding being classified — echo it verbatim.',
          },
          diffCaused: {
            type: 'boolean',
            description:
              'True when the problem is introduced by this diff; false when it is pre-existing or out of scope.',
          },
          confidence: {
            type: 'number',
            description:
              '0–100 confidence the finding is real AND correctly located, after checking the actual code. 90–100 only when traced or reproduced; below 60 means unverified.',
          },
          note: { type: 'string' },
        },
        required: ['id', 'diffCaused', 'confidence'],
      },
    },
  },
  required: ['verdicts'],
};

function validatorPrompt(contractText, findingsText, diffCmd) {
  return `You are the relevance/confidence validator for one review round. You CLASSIFY the findings below — you may NOT add findings of your own, and you MUST NOT edit any files.

${contractText}

The diff under review: \`${diffCmd}\`. Open the cited files and check every finding against the actual code before classifying it.

Findings to classify:
${findingsText}

Return one verdict per finding: its [id] echoed verbatim, diffCaused (introduced by this diff vs pre-existing/out-of-scope — a real problem the diff merely sits next to is NOT diff-caused), and confidence 0–100 that the finding is real and correctly located (90–100 only when you traced or reproduced it; below 60 means unverified). Classify every finding — no verdict means the finding passes through unfiltered.`;
}

// Thresholds: confidence ≥80 AND diff-caused → eligible for the fix pass.
// Confidence 60–79, or ≥80 but pre-existing → advisory (a PR note or a
// consolidations follow-up — never fixed in-slice). Below 60 → dropped as
// UNVERIFIED (recorded in the ledger so a repeat is visible). A missing
// verdict (validator died or skipped one) fails open: the finding stays
// eligible rather than silently dying.
function classifyFindings(findings, verdicts) {
  const map = new Map((verdicts || []).map((v) => [v.id, v]));
  return findings.map((f) => {
    const v = map.get(f.id);
    if (!v)
      return {
        finding: f,
        cls: 'eligible',
        confidence: null,
        diffCaused: true,
      };
    const cls =
      v.confidence < 60
        ? 'dropped'
        : v.confidence >= 80 && v.diffCaused
          ? 'eligible'
          : 'advisory';
    return {
      finding: f,
      cls,
      confidence: v.confidence,
      diffCaused: v.diffCaused,
    };
  });
}

// ── Independent closeout adjudicator ─────────────────────────────────────────
// When the loop ends with disputed entries, ONE fresh Opus agent rules each of
// them on evidence only: the final diff, the reviewer's original evidence, and
// the implementer's dispute evidence — never the fix agent's free-text
// justifications. Upheld findings reopen as `open` (reported in the stalled
// verdict); adjudicator/reviewer deadlock is never re-looped — it is reported
// on the PR for the human.

const ADJUDICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rulings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          ruling: { type: 'string', enum: ['upheld', 'dismissed'] },
          reason: { type: 'string' },
        },
        required: ['id', 'ruling', 'reason'],
      },
    },
  },
  required: ['rulings'],
};

function adjudicatorPrompt(contractText, disputedEntries, diffCmd) {
  const rows = disputedEntries
    .map(
      (e) =>
        `- [id: ${e.id}] (${e.area}) ${e.title}${e.file ? ` (${e.file}${e.line ? `:${e.line}` : ''})` : ''}
  Reviewer's evidence: ${e.detail}
  Implementer's dispute evidence: ${e.disputeEvidence || '(none recorded)'}`,
    )
    .join('\n');
  return `You are the INDEPENDENT closeout adjudicator for a review loop that ended with disputed findings. You are fresh — judge on evidence only, not on rhetoric. You MUST NOT edit any files.

${contractText}

Final diff: \`${diffCmd}\` — read it, plus the cited files, and check BOTH sides' evidence against the actual code.

Disputed findings:
${rows}

Rule EACH finding:
- "upheld": the reviewer's evidence holds — the problem is real and unresolved.
- "dismissed": the implementer's dispute evidence holds — the finding is factually wrong.
When the evidence is genuinely inconclusive, rule "upheld": a wrong dismissal silently removes a real finding, a wrong uphold costs one human glance.`;
}

function applyAdjudication(ledger, rulings) {
  const upheld = [];
  for (const r of rulings || []) {
    const e = ledger.entries.find(
      (x) => x.id === r.id && x.status === 'disputed',
    );
    if (!e) continue;
    e.ruling = `${r.ruling}: ${r.reason}`;
    if (r.ruling === 'upheld') {
      e.status = 'open';
      upheld.push(e);
    }
  }
  return upheld;
}

// ── Scope-fidelity lane ──────────────────────────────────────────────────────
// Optional reviewer lane, gated on the diff adding new files or >~150 inserted
// lines. Two passes inside one agent: a loose finder (full recall, no
// threshold) lists everything not traceable to the ticket's acceptance
// criteria, then a strict justifier keeps a finding only by citing a specific
// AC, a documented repo rule, or a concrete failure path the extra code
// prevents. Necessity comes from the frozen AC as written — never inferred
// from the diff. Output feeds the normal ledger and validator gate.

const SCOPE_LANE_INSERTION_GATE = 150;

function scopeLaneGate(addedFiles, diffStat) {
  if ((addedFiles || []).length > 0) return true;
  const m = /(\d+) insertions?/.exec(diffStat || '');
  return Boolean(m && Number(m[1]) > SCOPE_LANE_INSERTION_GATE);
}

function scopeFidelityPrompt(contractText, diffCmd) {
  return `You are the INDEPENDENT, READ-ONLY scope-fidelity reviewer for this change. You MUST NOT edit any files — only report.

${contractText}

Inspect the diff with \`${diffCmd}\` (and read surrounding files as needed). Work in two passes:

Pass 1 — loose finder (full recall, no threshold): list EVERYTHING in the diff that is not directly traceable to the acceptance criteria above — extra options/params/config, wrapper layers, generalisation beyond current callers, speculative branches, unasked-for behaviour, added surface area.
Pass 2 — strict justifier: keep an item ONLY when you can cite (a) a specific acceptance criterion it serves, (b) a documented repo rule (CLAUDE.md or a repo skill) that requires it, or (c) a concrete failure path the extra code prevents. Justified items are dropped. "Peer code does it too" alone is NOT a justification — such items become notes (judgement calls), never blockingFindings. Necessity comes from the acceptance criteria as written — never infer it from the diff itself.

Report ONLY:
- blockingFindings: additions that survived pass 2 with NO citable justification. Each with title, file, line, detail (why no AC / repo rule / failure path covers it), a concrete suggestedFix (usually delete or inline), and rootCause.
- notes: judgement-call items (including "peer code does it too" cases).
Set "area" to "scope". Do not invent problems to look productive — an empty blockingFindings array is the correct result for a tight diff.`;
}
// <<< shared:reviewer-registry

const AREA_COMPILED = compileAreaPaths(CFG.areaPaths || DEFAULT_AREA_PATHS);
const changedFiles = A.changedFiles || [];
const addedFiles = A.addedFiles || [];
const untrackedFiles = A.untrackedFiles || [];
const declaredAreas = A.declaredAreas || [];

// ── prompt builders ──────────────────────────────────────────────────────────
// Each reviewer only gets the untracked files in its own scope — lanes get
// their path-matched subset, baseline + reuse get the full list.
function contract(untrackedList) {
  return `This is an AD-HOC review — no slice ticket, no acceptance criteria unless given below, and NO fix loop: your findings go straight to the human, so make every one self-contained and actionable.
${CONTEXT ? `\nContext from the requester:\n${CONTEXT}\n` : ''}
Code under review — inspect it with:
\`${INSPECT}\`
(read surrounding files as needed for context)${
    untrackedList.length
      ? `\n\nUntracked NEW files also under review (NOT in the diff — read each in full):\n${untrackedList.map((f) => `- ${f}`).join('\n')}`
      : ''
  }`;
}

function untrackedForLane(members) {
  const memberSet = new Set(members);
  return untrackedFiles.filter((f) =>
    AREA_COMPILED.some(
      ([area, regexes]) =>
        memberSet.has(area) && regexes.some((r) => r.test(f)),
    ),
  );
}

function reviewerPrompt(area, def, untrackedList) {
  return `You are an INDEPENDENT, READ-ONLY reviewer for the "${area}" scope of this change. You MUST NOT edit any files — only report.

${contract(untrackedList)}

Apply the conventions from the ${def.skills} skill(s) — consult them via the Skill tool if available, otherwise apply their known rules.
Focus on: ${def.focus}

Report ONLY:
- blockingFindings: correctness bugs or convention/reuse violations in YOUR scope that should not ship. Each with title, file, line, detail, a concrete suggestedFix, and rootCause (a short slug of the underlying cause). If none, return an empty array.
- notes: judgement-call / debatable points that should NOT block.
Set "area" to "${area}". Do not invent problems to look productive — an empty blockingFindings array is the correct result for clean code.`;
}

function reusePrompt(added, modified) {
  return `You are the INDEPENDENT, READ-ONLY reuse/consolidation reviewer for this change. You MUST NOT edit any files — only report.

${contract(untrackedFiles)}

Files ADDED by this change:
${added.length ? added.map((f) => `- ${f}`).join('\n') : '(none)'}

Files MODIFIED by this change (in scope for intra-diff DRY + YAGNI):
${modified.length ? modified.map((f) => `- ${f}`).join('\n') : '(none)'}

This is an ad-hoc review: there is NO implementer provenance table to audit. Focus on: ${REUSE.focus}
${LIB_MAP ? `\nExisting libs (search index for equivalents):\n${LIB_MAP}` : ''}

Report ONLY:
- blockingFindings: (a) an added function/component/hook/util/type that duplicates an existing lib/design-system equivalent — name the equivalent, the fix is "use it, delete the copy"; (b) the same logic repeated within the diff where a small local helper would remove it. Each with title, file, line, detail, concrete suggestedFix.
- consolidations: genuinely generalizable NEW code that belongs in an existing lib as follow-up work — title, detail (what + which call sites would adopt it), targetLib. NEVER put these in blockingFindings.
- notes: judgement-call points that should not block.
Set "area" to "reuse". Do not invent problems to look productive — empty arrays are the correct result for clean code.`;
}

// ── run: one parallel review round, no fix loop ──────────────────────────────
phase('Review');
const areas = selectAreas(
  AREA_COMPILED,
  [...changedFiles, ...untrackedFiles],
  declaredAreas,
);
const laneEntries = groupAreasByLane(areas);
// untracked files are added-by-definition; modified files gate reuse too (intra-diff DRY/YAGNI)
const reuseAdded = [...new Set([...addedFiles, ...untrackedFiles])];
const reuseModified = changedFiles.filter((f) => !addedFiles.includes(f));
const runReuse = reuseAdded.length + reuseModified.length > 0;
const runCodeRabbit = Boolean(CODERABBIT_CMD);
// Scope fidelity needs an AC contract to justify against — no AC, no lane.
const runScope =
  HAS_AC && (reuseAdded.length > 0 || INSERTIONS > SCOPE_LANE_INSERTION_GATE);
const ran = [
  'baseline',
  ...laneEntries.map(([lane, members]) => `${lane}[${members.join('+')}]`),
  ...(runReuse ? ['reuse'] : []),
  ...(runScope ? ['scope'] : []),
  ...(runCodeRabbit ? ['coderabbit'] : []),
];
log(
  `Reviewers: ${ran.join(', ')} (${changedFiles.length + untrackedFiles.length} file(s) under review)`,
);

const thunks = [
  () =>
    agent(reviewerPrompt('baseline', BASELINE, untrackedFiles), {
      label: 'review:baseline',
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    }),
];
for (const [lane, members] of laneEntries) {
  thunks.push(() =>
    agent(reviewerPrompt(lane, laneDef(members), untrackedForLane(members)), {
      label: `review:${lane}`,
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    }),
  );
}
if (runReuse) {
  thunks.push(() =>
    agent(reusePrompt(reuseAdded, reuseModified), {
      label: 'review:reuse',
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    }),
  );
}
if (runScope) {
  thunks.push(() =>
    agent(scopeFidelityPrompt(contract(untrackedFiles), INSPECT), {
      label: 'review:scope',
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    }),
  );
}
if (runCodeRabbit) {
  thunks.push(() =>
    agent(coderabbitPrompt(contract(untrackedFiles), CODERABBIT_CMD), {
      label: 'review:coderabbit',
      phase: 'Review',
      model: 'sonnet',
      schema: FINDINGS_SCHEMA,
    }),
  );
}

const results = await parallel(thunks);
const reviews = results.filter(Boolean);
const died = results.length - reviews.length;
if (died > 0)
  log(
    `${died} of ${results.length} reviewer agent(s) died — their scope went unreviewed.`,
  );

const raw = reviews.flatMap((r) =>
  (r.blockingFindings || []).map((f) => ({ ...f, area: r.area })),
);
raw.forEach((f, i) => {
  f.id = `f-${i + 1}`; // tag for the validator; the ledger mints the stable CR id
});
const notes = reviews.flatMap((r) =>
  (r.notes || []).map((n) => `[${r.area}] ${n}`),
);
const consolidations = reviews.flatMap((r) => r.consolidations || []);

// Relevance + confidence validator: classifies the raw findings (diff-caused?
// confidence 0–100?) before they reach the report — it never adds findings.
// ≥80 + diff-caused = blocking; 60–79 or pre-existing = advisory; <60 = unverified.
let validated = [];
if (raw.length) {
  const val = await agent(
    validatorPrompt(contract(untrackedFiles), fmtFeedback(raw), INSPECT),
    {
      label: 'validate',
      phase: 'Review',
      model: 'sonnet',
      schema: VALIDATION_SCHEMA,
    },
  );
  if (!val) log('Validator died — findings pass through unclassified.');
  validated = classifyFindings(raw, val && val.verdicts);
}

// Single round, but the ledger still assigns the stable CR ids the report uses.
const ledger = createLedger();
ledgerIngest(ledger, 1, validated);
const blocking = ledgerOpenBlocking(ledger).map((e) => ({
  ...ledgerEntryFinding(e),
  confidence: e.confidence,
}));
const advisory = ledger.entries
  .filter((e) => e.status === 'open' && e.severity === 'advisory')
  .map((e) => ({
    ...ledgerEntryFinding(e),
    confidence: e.confidence,
    preExisting: e.diffCaused === false,
  }));
const unverified = ledger.entries
  .filter((e) => e.status === 'dropped')
  .map((e) => ({
    ...ledgerEntryFinding(e),
    confidence: e.confidence,
  }));

log(
  blocking.length === 0
    ? died === 0
      ? 'Clean — no blocking findings.'
      : `No blocking findings, but ${died} reviewer(s) died — NOT a clean verdict.`
    : `${blocking.length} blocking finding(s) across ${new Set(blocking.map((f) => f.area)).size} reviewer(s) (${advisory.length} advisory, ${unverified.length} unverified).`,
);

return {
  // zero blocking findings only counts as clean when every spawned reviewer actually reported
  clean: blocking.length === 0 && died === 0,
  reviewers: ran,
  areasTriggered: areas,
  reviewersSpawned: results.length,
  reviewersDied: died,
  reviewersReturned: reviews.map((r) => r.area),
  blockingFindings: blocking,
  // Demoted by the relevance gate: real-but-lower-confidence or pre-existing —
  // worth a human glance, never a "fix before ship" item.
  advisoryFindings: advisory,
  // Dropped as UNVERIFIED (confidence < 60) — listed so nothing dies silently.
  unverified,
  notes: [...new Set(notes)],
  consolidations: [
    ...new Map(consolidations.map((c) => [c.title, c])).values(),
  ],
};
