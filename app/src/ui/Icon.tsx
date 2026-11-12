import {
  Image,
  Plus,
  LayoutGrid,
  SlidersHorizontal,
  CircleHelp,
  Languages,
  Sun,
  Moon,
  Upload,
  X,
} from "lucide-react";
// All app icons use this allowlisted owner; Lucide's ISC license ships with the pinned package.
const icons = {
  image: Image,
  create: Plus,
  library: LayoutGrid,
  settings: SlidersHorizontal,
  help: CircleHelp,
  language: Languages,
  sun: Sun,
  moon: Moon,
  upload: Upload,
  close: X,
};
export function Icon({ name }: { name: keyof typeof icons }) {
  const Component = icons[name];
  return (
    <Component
      className="ui-icon"
      aria-hidden="true"
      focusable="false"
      strokeWidth={1.7}
    />
  );
}
