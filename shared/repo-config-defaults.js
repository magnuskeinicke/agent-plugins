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
