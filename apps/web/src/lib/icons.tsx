// The app's only icon set: Hugeicons (stroke style). Import icons from here so sizes and strokes stay consistent.
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  BlockedIcon,
  Call02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CheckmarkSquare02Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  FilterIcon,
  FunnelIcon,
  Key01Icon,
  LeftToRightListBulletIcon,
  LockIcon,
  Logout01Icon,
  Menu01Icon,
  Mic01Icon,
  MoreHorizontalIcon,
  Notification01Icon,
  PaintBoardIcon,
  PlayIcon,
  QrCodeIcon,
  Search01Icon,
  SecurityCheckIcon,
  Settings02Icon,
  SquareIcon,
  StarIcon,
  Store01Icon,
  Target02Icon,
  Task01Icon,
  Tick02Icon,
  UserGroupIcon,
  Download04Icon,
  WhatsappIcon,
  Mail01Icon,
  MinusSignIcon,
  Refresh01Icon,
  InformationCircleIcon,
  SmartPhone01Icon,
  Table01Icon,
  GridViewIcon,
} from '@hugeicons/core-free-icons';

export const icons = {
  add: Add01Icon,
  alert: Alert02Icon,
  down: ArrowDown01Icon,
  back: ArrowLeft01Icon,
  forward: ArrowRight01Icon,
  up: ArrowUp01Icon,
  external: ArrowUpRight01Icon,
  blocked: BlockedIcon,
  call: Call02Icon,
  close: Cancel01Icon,
  ok: CheckmarkCircle02Icon,
  checked: CheckmarkSquare02Icon,
  unchecked: SquareIcon,
  delete: Delete02Icon,
  drag: DragDropVerticalIcon,
  filter: FilterIcon,
  funnel: FunnelIcon,
  key: Key01Icon,
  form: LeftToRightListBulletIcon,
  lock: LockIcon,
  logout: Logout01Icon,
  menu: Menu01Icon,
  mic: Mic01Icon,
  more: MoreHorizontalIcon,
  bell: Notification01Icon,
  brand: PaintBoardIcon,
  play: PlayIcon,
  qr: QrCodeIcon,
  search: Search01Icon,
  audit: SecurityCheckIcon,
  settings: Settings02Icon,
  star: StarIcon,
  store: Store01Icon,
  target: Target02Icon,
  leads: Task01Icon,
  tick: Tick02Icon,
  team: UserGroupIcon,
  download: Download04Icon,
  whatsapp: WhatsappIcon,
  mail: Mail01Icon,
  minus: MinusSignIcon,
  refresh: Refresh01Icon,
  info: InformationCircleIcon,
  phone: SmartPhone01Icon,
  table: Table01Icon,
  cards: GridViewIcon,
} as const;

export type IconName = keyof typeof icons;

/** Decorative by default (aria-hidden); pass `label` when the icon is the only content of a control. */
export function Icon({ name, size = 18, className, label, filled }: { name: IconName; size?: number; className?: string; label?: string; filled?: boolean }) {
  return (
    <HugeiconsIcon
      icon={icons[name]}
      size={size}
      strokeWidth={1.75}
      className={`shrink-0 ${className ?? ''}`}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}
