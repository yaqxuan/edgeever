import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type PortableTarget = HTMLElement & {
  dataset: DOMStringMap & {
    edgeeverAbbrTitle?: string;
    edgeeverFootnote?: string;
  };
};

type TooltipState = {
  target: PortableTarget;
  left: number;
  top: number;
  pinned: boolean;
  kind: "abbr" | "footnote";
  label: string;
  preview?: string;
  heading?: HTMLHeadingElement;
};

const INTERACTIVE_SELECTOR = "abbr[data-edgeever-abbr-title], sup[data-edgeever-footnote]";
const FOOTNOTE_PATTERN = /^\[([^\]\r\n]+)\]$/u;

const getPortableTarget = (eventTarget: EventTarget | null, root: HTMLElement) => {
  if (!(eventTarget instanceof Element)) return null;
  const target = eventTarget.closest<PortableTarget>(INTERACTIVE_SELECTOR);
  return target && root.contains(target) ? target : null;
};

const readFootnote = (target: PortableTarget) => {
  const match = target.textContent?.trim().match(FOOTNOTE_PATTERN);
  return match?.[1]?.trim() || "";
};

const normalizePreviewText = (value: string) => value.replace(/\s+/gu, " ").trim();

const findFootnoteHeading = (root: HTMLElement, reference: string) => {
  const expected = `[${reference}]`;
  return Array.from(root.querySelectorAll<HTMLHeadingElement>("h3"))
    .find((heading) => normalizePreviewText(heading.textContent || "").startsWith(expected));
};

const buildFootnotePreview = (heading: HTMLHeadingElement) => {
  const pieces = [normalizePreviewText(heading.textContent || "")];
  let sibling = heading.nextElementSibling;
  while (sibling && !/^H[1-3]$/u.test(sibling.tagName) && pieces.join(" ").length < 420) {
    const text = normalizePreviewText(sibling.textContent || "");
    if (text) pieces.push(text);
    sibling = sibling.nextElementSibling;
  }
  const preview = pieces.join(" · ");
  return preview.length > 440 ? `${preview.slice(0, 437)}…` : preview;
};

const positionForTarget = (target: HTMLElement) => {
  const rect = target.getBoundingClientRect();
  return {
    left: rect.left + rect.width / 2,
    top: rect.top,
  };
};

const describeTarget = (target: PortableTarget, root: HTMLElement, pinned: boolean): TooltipState | null => {
  const position = positionForTarget(target);
  if (target.matches("abbr[data-edgeever-abbr-title]")) {
    const label = target.dataset.edgeeverAbbrTitle?.trim();
    return label ? { target, ...position, pinned, kind: "abbr", label } : null;
  }

  const reference = readFootnote(target);
  if (!reference) return null;
  const heading = findFootnoteHeading(root, reference);
  return {
    target,
    ...position,
    pinned,
    kind: "footnote",
    label: `[${reference}]`,
    preview: heading ? buildFootnotePreview(heading) : `没有找到对应的 ### [${reference}] 注释`,
    heading,
  };
};

export const PortableHtmlInteractionController = ({ editor }: { editor: Editor | null }) => {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const root = editor.view.dom;
    const show = (target: PortableTarget, pinned: boolean) => {
      setTooltip(describeTarget(target, root, pinned));
    };
    const closeUnpinned = () => setTooltip((current) => (current?.pinned ? current : null));

    const handleMouseOver = (event: MouseEvent) => {
      const target = getPortableTarget(event.target, root);
      if (target) show(target, false);
    };
    const handleMouseOut = (event: MouseEvent) => {
      const target = getPortableTarget(event.target, root);
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
      closeUnpinned();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = getPortableTarget(event.target, root);
      if (target) show(target, false);
    };
    const handleFocusOut = () => window.setTimeout(closeUnpinned, 0);
    const handleClick = (event: MouseEvent) => {
      const target = getPortableTarget(event.target, root);
      if (!target) return;
      setTooltip((current) => {
        if (current?.target === target && current.pinned) return null;
        return describeTarget(target, root, true);
      });
    };
    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-edgeever-portable-tooltip]") || getPortableTarget(event.target, root)) return;
      setTooltip(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTooltip(null);
    };
    const updatePosition = () => setTooltip((current) => current
      ? { ...current, ...positionForTarget(current.target) }
      : current);
    const handleEditorUpdate = () => setTooltip(null);

    root.addEventListener("mouseover", handleMouseOver);
    root.addEventListener("mouseout", handleMouseOut);
    root.addEventListener("focusin", handleFocusIn);
    root.addEventListener("focusout", handleFocusOut);
    root.addEventListener("click", handleClick);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    editor.on("update", handleEditorUpdate);

    return () => {
      root.removeEventListener("mouseover", handleMouseOver);
      root.removeEventListener("mouseout", handleMouseOut);
      root.removeEventListener("focusin", handleFocusIn);
      root.removeEventListener("focusout", handleFocusOut);
      root.removeEventListener("click", handleClick);
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      editor.off("update", handleEditorUpdate);
    };
  }, [editor]);

  const jumpToFootnote = () => {
    if (!tooltip?.heading) return;
    tooltip.heading.scrollIntoView({ behavior: "smooth", block: "center" });
    tooltip.heading.classList.remove("edgeever-footnote-jump-target");
    tooltip.heading.classList.add("edgeever-footnote-jump-target");
    window.setTimeout(() => tooltip.heading?.classList.remove("edgeever-footnote-jump-target"), 4000);
    setTooltip(null);
  };

  return (
    <TooltipProvider delayDuration={140}>
      <Tooltip open={Boolean(tooltip)}>
        <TooltipTrigger asChild>
          <span
            aria-hidden="true"
            className="edgeever-portable-tooltip-anchor pointer-events-none fixed h-px w-px"
            style={{ left: tooltip?.left ?? -1000, top: tooltip?.top ?? -1000 }}
          />
        </TooltipTrigger>
        {tooltip && (
          <TooltipContent
            data-edgeever-portable-tooltip="true"
            side="top"
            className="edgeever-portable-tooltip max-w-[min(22rem,calc(100vw-2rem))] text-left text-sm leading-6"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {tooltip.kind === "abbr" ? (
              <span>{tooltip.label}</span>
            ) : (
              <div className="edgeever-portable-tooltip-body space-y-2">
                <div>{tooltip.preview}</div>
                {tooltip.heading && (
                  <button
                    type="button"
                    className="edgeever-portable-tooltip-jump rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      jumpToFootnote();
                    }}
                  >
                    跳到注释
                  </button>
                )}
              </div>
            )}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
};
