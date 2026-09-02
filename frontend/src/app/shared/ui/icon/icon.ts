import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * One icon set for the whole product: 24 unit grid, 1.5 stroke, round caps and
 * joins, no fills. Names ending in `-next`, `-prev`, `-first` and `-last` are
 * direction bearing and mirror automatically under RTL; everything else, such
 * as `clock` or `user`, keeps its orientation in both directions.
 */
export type IconName =
  // Direction bearing, mirrored in RTL.
  | 'chevron-next'
  | 'chevron-prev'
  | 'chevron-first'
  | 'chevron-last'
  | 'arrow-next'
  | 'arrow-prev'
  | 'return-loop'
  | 'sign-out'
  | 'send'
  // Direction neutral.
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-up'
  | 'arrow-down'
  | 'sort'
  | 'search'
  | 'filter'
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'edit'
  | 'trash'
  | 'copy'
  | 'download'
  | 'upload'
  | 'print'
  | 'refresh'
  | 'external'
  | 'more'
  | 'menu'
  | 'settings'
  | 'eye'
  | 'paperclip'
  | 'check-circle'
  | 'alert-triangle'
  | 'alert-circle'
  | 'info'
  | 'x-circle'
  | 'help'
  | 'clock'
  | 'hourglass'
  | 'shield'
  | 'lock'
  | 'flag'
  | 'urgent'
  | 'file'
  | 'file-check'
  | 'folder'
  | 'inbox'
  | 'user'
  | 'users'
  | 'building'
  | 'globe'
  | 'calendar'
  | 'mail'
  | 'phone'
  | 'comment'
  | 'history'
  | 'layers'
  | 'workflow'
  | 'circle-dot'
  | 'circle'
  | 'chart'
  | 'trending'
  | 'home'
  | 'checklist'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'spinner'
  | 'stamp';

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';

const DIRECTIONAL: ReadonlySet<IconName> = new Set<IconName>([
  'chevron-next',
  'chevron-prev',
  'chevron-first',
  'chevron-last',
  'arrow-next',
  'arrow-prev',
  'return-loop',
  'sign-out',
  'send',
]);

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './icon.scss',
  host: {
    class: 'icon',
    '[class.icon--sm]': "size() === 'sm'",
    '[class.icon--md]': "size() === 'md'",
    '[class.icon--lg]': "size() === 'lg'",
    '[class.icon--xl]': "size() === 'xl'",
  },
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      [class.icon__glyph--mirrored]="mirrored()"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label()"
      class="icon__glyph"
    >
      @switch (name()) {
        @case ('chevron-next') {
          <path d="m9 18 6-6-6-6" />
        }
        @case ('chevron-prev') {
          <path d="m15 18-6-6 6-6" />
        }
        @case ('chevron-first') {
          <path d="m11 17-5-5 5-5" />
          <path d="m18 17-5-5 5-5" />
        }
        @case ('chevron-last') {
          <path d="m6 17 5-5-5-5" />
          <path d="m13 17 5-5-5-5" />
        }
        @case ('arrow-next') {
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        }
        @case ('arrow-prev') {
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        }
        @case ('return-loop') {
          <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          <path d="m9 14-5-5 5-5" />
        }
        @case ('sign-out') {
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        }
        @case ('send') {
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        }
        @case ('chevron-down') {
          <path d="m6 9 6 6 6-6" />
        }
        @case ('chevron-up') {
          <path d="m18 15-6-6-6 6" />
        }
        @case ('arrow-up') {
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        }
        @case ('arrow-down') {
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        }
        @case ('sort') {
          <path d="m21 16-4 4-4-4" />
          <path d="M17 20V4" />
          <path d="m3 8 4-4 4 4" />
          <path d="M7 4v16" />
        }
        @case ('search') {
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        }
        @case ('filter') {
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        }
        @case ('plus') {
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        }
        @case ('minus') {
          <path d="M5 12h14" />
        }
        @case ('close') {
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        }
        @case ('check') {
          <path d="M20 6 9 17l-5-5" />
        }
        @case ('edit') {
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path
            d="M18.4 2.6a1.8 1.8 0 0 1 2.5 2.5l-8.6 8.6a2 2 0 0 1-.9.5l-2.6.7a.5.5 0 0 1-.6-.6l.7-2.6a2 2 0 0 1 .5-.9z"
          />
        }
        @case ('trash') {
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        }
        @case ('copy') {
          <rect x="8" y="8" width="13" height="13" rx="2" />
          <path d="M4 16a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2" />
        }
        @case ('download') {
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 10 5 5 5-5" />
          <path d="M12 15V3" />
        }
        @case ('upload') {
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m17 8-5-5-5 5" />
          <path d="M12 3v12" />
        }
        @case ('print') {
          <path d="M6 9V2h12v7" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" rx="1" />
        }
        @case ('refresh') {
          <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
          <path d="M8 16H3v5" />
        }
        @case ('external') {
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        }
        @case ('more') {
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        }
        @case ('menu') {
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        }
        @case ('settings') {
          <path d="M20 7h-9" />
          <path d="M14 17H5" />
          <circle cx="17" cy="17" r="3" />
          <circle cx="7" cy="7" r="3" />
        }
        @case ('eye') {
          <path d="M2.1 12.3a1 1 0 0 1 0-.7 10.7 10.7 0 0 1 19.8 0 1 1 0 0 1 0 .7 10.7 10.7 0 0 1-19.8 0" />
          <circle cx="12" cy="12" r="3" />
        }
        @case ('paperclip') {
          <path
            d="m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6A4 4 0 1 1 18 8.8l-8.6 8.6a2 2 0 0 1-2.8-2.9l8.5-8.4"
          />
        }
        @case ('check-circle') {
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12 2.5 2.5 4.5-4.5" />
        }
        @case ('alert-triangle') {
          <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        }
        @case ('alert-circle') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4.5" />
          <path d="M12 16h.01" />
        }
        @case ('info') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4.5" />
          <path d="M12 8h.01" />
        }
        @case ('x-circle') {
          <circle cx="12" cy="12" r="9" />
          <path d="m15 9-6 6" />
          <path d="m9 9 6 6" />
        }
        @case ('help') {
          <circle cx="12" cy="12" r="9" />
          <path d="M9.2 9.3a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        }
        @case ('clock') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5.2l3.4 2" />
        }
        @case ('hourglass') {
          <path d="M5 22h14" />
          <path d="M5 2h14" />
          <path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22" />
          <path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2" />
        }
        @case ('shield') {
          <path
            d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"
          />
          <path d="m9 12 2 2 4-4" />
        }
        @case ('lock') {
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        }
        @case ('flag') {
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <path d="M4 22v-7" />
        }
        @case ('urgent') {
          <path
            d="M4 14a1 1 0 0 1-.8-1.6l9.9-10.2a.5.5 0 0 1 .9.5l-1.9 6a1 1 0 0 0 .9 1.3h7a1 1 0 0 1 .8 1.6l-9.9 10.2a.5.5 0 0 1-.9-.5l1.9-6a1 1 0 0 0-.9-1.3z"
          />
        }
        @case ('file') {
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        }
        @case ('file-check') {
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="m9 15 2 2 4-4" />
        }
        @case ('folder') {
          <path
            d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
          />
        }
        @case ('inbox') {
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" />
        }
        @case ('user') {
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        }
        @case ('users') {
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
          <path d="M16 3.1a4 4 0 0 1 0 7.8" />
        }
        @case ('building') {
          <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
          <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
          <path d="M10 6h4" />
          <path d="M10 10h4" />
          <path d="M10 14h4" />
        }
        @case ('globe') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a13 13 0 0 0 0 18 13 13 0 0 0 0-18" />
          <path d="M3 12h18" />
        }
        @case ('calendar') {
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4" />
          <path d="M8 3v4" />
          <path d="M3 10h18" />
        }
        @case ('mail') {
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7" />
        }
        @case ('phone') {
          <path
            d="M13.8 16.6a1 1 0 0 0 1.2-.3l.4-.5a2 2 0 0 1 1.6-.8h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.5.4a1 1 0 0 0-.3 1.2 14 14 0 0 0 6.4 6.4"
          />
        }
        @case ('comment') {
          <path d="M22 17a2 2 0 0 1-2 2H6l-4 4V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
        }
        @case ('history') {
          <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7.5V12l3 1.8" />
        }
        @case ('layers') {
          <path d="M12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8z" />
          <path d="m6.1 9.5-3.5 1.6a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8l-3.5-1.6" />
          <path d="m6.1 14.5-3.5 1.6a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8l-3.5-1.6" />
        }
        @case ('workflow') {
          <path d="M6 3v12" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        }
        @case ('circle-dot') {
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="2.5" />
        }
        @case ('circle') {
          <circle cx="12" cy="12" r="9" />
        }
        @case ('chart') {
          <path d="M3 3v16a2 2 0 0 0 2 2h16" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        }
        @case ('trending') {
          <path d="M16 7h6v6" />
          <path d="m22 7-8.5 8.5-5-5L2 17" />
        }
        @case ('home') {
          <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
          <path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        }
        @case ('checklist') {
          <path d="m3 17 2 2 4-4" />
          <path d="m3 7 2 2 4-4" />
          <path d="M13 6h8" />
          <path d="M13 12h8" />
          <path d="M13 18h8" />
        }
        @case ('sun') {
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.9 4.9 1.4 1.4" />
          <path d="m17.7 17.7 1.4 1.4" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.3 17.7-1.4 1.4" />
          <path d="m19.1 4.9-1.4 1.4" />
        }
        @case ('moon') {
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        }
        @case ('monitor') {
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        }
        @case ('spinner') {
          <path d="M12 3v3" />
          <path d="m17.7 6.3-2.1 2.1" />
          <path d="M21 12h-3" />
          <path d="m17.7 17.7-2.1-2.1" />
          <path d="M12 18v3" />
          <path d="m6.3 17.7 2.1-2.1" />
          <path d="M3 12h3" />
          <path d="m6.3 6.3 2.1 2.1" />
        }
        @case ('stamp') {
          <path d="M5 22h14" />
          <path d="M19.3 13.7A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.7-.3-1.3-.7-1.8" />
          <path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13" />
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input<IconSize>('md');

  /**
   * Accessible name. Leave unset for the common case where the icon sits inside
   * a labelled control and would only add noise for a screen reader.
   */
  readonly label = input<string | null>(null);

  protected readonly mirrored = computed(() => DIRECTIONAL.has(this.name()));
}
