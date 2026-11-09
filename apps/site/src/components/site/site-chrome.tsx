import { ArrowRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";

import { FarmerMark } from "#/components/farmer-mark.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import { githubLinks, LICENSE_NAME, REPOSITORY } from "#/lib/links.ts";

// Every rule the public site uses, scoped under `.fm-site`.
import "./site.css";
import { WheatField } from "./wheat-field.tsx";

/** Where the call-to-action goes: the app resolves `/_` to the workspace,
 *  `/login` or `/no-access`. A plain anchor, because `/_` is not a site route. */
const APP_ENTRY = "/_";

/** The page's one CTA. Rendered identically in the header and in the body, so
 *  the action never changes shape as you scroll past it. */
export function SiteCta({ className = "fm-btn" }: { className?: string }) {
	return (
		<a className={className} href={APP_ENTRY}>
			Open farmer
			<ArrowRightIcon size={16} aria-hidden />
		</a>
	);
}

/** Farmer's mark and name, linked to the front page. */
export function SiteBrand({ size = 26 }: { size?: number }) {
	return (
		<Link to="/" className="fm-brand" aria-label="Farmer, front page">
			<FarmerMark size={size} />
			<span className="fm-brand-name" style={{ fontSize: size + 3 }}>
				Farmer
			</span>
		</Link>
	);
}

const NAV = [
	{ label: "Features", to: "/", hash: "features" },
	{ label: "Self-hosting", to: "/self-hosting" },
	{ label: "Changelog", to: "/changelog" },
	{ label: "About", to: "/about" },
] as const;

/** How far past the top the page scrolls before the header's hairline is fully
 *  drawn. */
const SCROLL_DISTANCE = 48;

/** How long each spring takes to catch up with its target, in seconds: its
 *  period. */
const EDGE_RESPONSE = 0.3;
const INK_RESPONSE = 0.3;

/** The line in the viewport that decides whether the header sits over an ink
 *  band: the middle of the header. */
const HEADER_MIDLINE = 31;

/** 1 while the header's midline is over an element marked
 *  `data-header-ink`, such as the front page's dark Developers band. */
const overInk = () => {
	for (const band of document.querySelectorAll("[data-header-ink]")) {
		const { top, bottom } = band.getBoundingClientRect();
		if (top <= HEADER_MIDLINE && bottom >= HEADER_MIDLINE) return 1;
	}
	return 0;
};

/** Input that can move the page. Until the first of these, every scroll is
 *  the page's own doing. */
const USER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Drives the header's two custom properties from the scroll, so the CSS can
 * draw every state in between (see the Header block in site.css):
 *
 * - `--fm-scrolled`: 0 at the top of the page, 1 once it has scrolled, which
 *   fades in the header's glass and its bottom hairline.
 * - `--fm-ink`: 0 is the page's own palette, 1 is the ink palette, while the
 *   header passes over a dark band.
 *
 * The scroll sets where each is going, not where it is. A critically damped
 * spring chases each target, so one wheel notch fades the hairline in over a
 * moment rather than in one frame, and a scroll back mid-way turns it around
 * from where it is. Nothing here moves, so reduced motion keeps the fades.
 *
 * A scroll nobody asked for snaps. Each public page mounts its own header,
 * and the router moves the page to the top, or back to where it was, only
 * after the header exists. Sprung, that faded the hairline out on every page
 * change. So the springs only animate once the reader has touched the page.
 *
 * Straight to the DOM from a frame loop rather than through React state, and
 * the loop stops once both springs are at rest.
 */
function useHeaderSprings(ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const header = ref.current;
		if (!header) return;
		const scrolledTarget = () => {
			const t = Math.min(Math.max(window.scrollY / SCROLL_DISTANCE, 0), 1);
			return t * t * (3 - 2 * t);
		};
		const springs = [
			{
				name: "--fm-scrolled",
				target: scrolledTarget,
				omega: (2 * Math.PI) / EDGE_RESPONSE,
				value: 0,
				velocity: 0,
			},
			{
				name: "--fm-ink",
				target: overInk,
				omega: (2 * Math.PI) / INK_RESPONSE,
				value: 0,
				velocity: 0,
			},
		];
		for (const spring of springs) spring.value = spring.target();
		let touched = false;
		let frame = 0;
		// -1 until the loop's first frame, which has no previous one.
		let last = -1;
		const write = () => {
			for (const spring of springs) {
				header.style.setProperty(spring.name, String(spring.value));
			}
		};
		const step = (now: number) => {
			// A loop started from a scroll event gets its first frame in the
			// same rendering pass, with a timestamp from before the event, so a
			// measured first step would run backwards and draw nothing. Give it
			// one frame instead. Capped, so a tab that slept does not arrive
			// with a huge step.
			const dt =
				last < 0 ? 1 / 60 : Math.min(Math.max((now - last) / 1000, 0), 1 / 30);
			last = now;
			let settled = true;
			for (const spring of springs) {
				const goal = spring.target();
				if (!touched) {
					spring.value = goal;
					spring.velocity = 0;
					continue;
				}
				// The exact solution of a critically damped spring over `dt`,
				// so it is stable at any frame rate.
				const { omega } = spring;
				const offset = spring.value - goal;
				const decay = Math.exp(-omega * dt);
				const k = spring.velocity + omega * offset;
				spring.value = goal + (offset + k * dt) * decay;
				spring.velocity = (spring.velocity - omega * k * dt) * decay;
				if (
					Math.abs(spring.value - goal) < 0.0005 &&
					Math.abs(spring.velocity) < 0.0005
				) {
					spring.value = goal;
					spring.velocity = 0;
				} else {
					settled = false;
				}
			}
			write();
			frame = settled ? 0 : requestAnimationFrame(step);
		};
		const onScroll = () => {
			if (frame) return;
			last = -1;
			frame = requestAnimationFrame(step);
		};
		const onInput = () => {
			touched = true;
		};
		write();
		window.addEventListener("scroll", onScroll, { passive: true });
		for (const type of USER_INPUT) {
			window.addEventListener(type, onInput, { passive: true, once: true });
		}
		return () => {
			window.removeEventListener("scroll", onScroll);
			for (const type of USER_INPUT) {
				window.removeEventListener(type, onInput);
			}
			cancelAnimationFrame(frame);
		};
	}, [ref]);
}

/**
 * Runs the `.fm-em` sheen (site.css) inside `ref`: one pass as each phrase
 * first comes into view, and one on each hover. `data-sheen` is the whole
 * state — set to start a pass, cleared on `animationend` — so a hover during
 * a pass lets that pass finish rather than restarting it mid-sweep.
 */
export function useEmSheen(ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const root = ref.current;
		if (!root) return;
		const play = (el: Element, why: "view" | "hover") => {
			if (!(el instanceof HTMLElement) || el.dataset.sheen) return;
			el.dataset.sheen = why;
		};
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					play(entry.target, "view");
					observer.unobserve(entry.target);
				}
			},
			{ rootMargin: "0px 0px -15% 0px" },
		);
		// Each phrase plays its view pass one time, also after a re-render.
		const seen = new WeakSet<Element>();
		const watch = (node: Node) => {
			if (!(node instanceof Element)) return;
			const found = [...node.querySelectorAll(".fm-em")];
			if (node.matches(".fm-em")) found.push(node);
			for (const el of found) {
				if (seen.has(el)) continue;
				seen.add(el);
				observer.observe(el);
			}
		};
		watch(root);
		// A phrase that renders after mount (a lazy section, a new route in
		// the same page shell) is watched too.
		const added = new MutationObserver((records) => {
			for (const record of records) record.addedNodes.forEach(watch);
		});
		added.observe(root, { childList: true, subtree: true });
		const onOver = (event: PointerEvent) => {
			if (!(event.target instanceof Element)) return;
			const em = event.target.closest(".fm-em");
			if (em) play(em, "hover");
		};
		const onEnd = (event: AnimationEvent) => {
			if (event.animationName !== "fm-sheen") return;
			if (event.target instanceof HTMLElement)
				delete event.target.dataset.sheen;
		};
		root.addEventListener("pointerover", onOver);
		root.addEventListener("animationend", onEnd);
		return () => {
			observer.disconnect();
			added.disconnect();
			root.removeEventListener("pointerover", onOver);
			root.removeEventListener("animationend", onEnd);
		};
	}, [ref]);
}

export function SiteHeader() {
	const { home } = githubLinks(REPOSITORY);
	const headerRef = useRef<HTMLElement>(null);
	useHeaderSprings(headerRef);
	return (
		<header ref={headerRef} className="fm-header">
			<div className="fm-container fm-header-inner">
				<SiteBrand />
				<nav className="fm-nav fm-sm-hide" aria-label="Site">
					{NAV.map((item) => (
						<Link
							key={item.label}
							to={item.to}
							hash={"hash" in item ? item.hash : undefined}
							// The Features anchor lives on `/`, so it is never "the
							// current page" — only the real pages mark themselves. The
							// search is ignored, so a Changelog filter keeps its tab lit.
							activeOptions={{
								exact: true,
								includeHash: true,
								includeSearch: false,
							}}
							activeProps={
								"hash" in item ? undefined : { "aria-current": "page" }
							}
						>
							{item.label}
						</Link>
					))}
				</nav>
				<div className="fm-header-actions">
					<ThemeToggle
						className="fm-btn fm-btn-outline fm-btn-sm fm-btn-icon"
						iconClassName="fm-theme-icon"
					/>
					<a className="fm-btn fm-btn-outline fm-btn-sm fm-sm-hide" href={home}>
						<GithubLogoIcon size={16} aria-hidden />
						GitHub
					</a>
					<SiteCta className="fm-btn fm-btn-sm" />
				</div>
			</div>
		</header>
	);
}

export function SiteFooter() {
	const links = githubLinks(REPOSITORY);
	return (
		<footer>
			<div className="fm-container fm-footer-grid">
				<div className="fm-footer-about">
					<SiteBrand />
					<p
						className="fm-muted"
						style={{
							margin: 0,
							fontSize: 14,
							lineHeight: 1.55,
							maxWidth: "34ch",
							textWrap: "pretty",
						}}
					>
						Open-source, self-hosted time tracking. Built by Profico and used
						there every day.
					</p>
				</div>
				<div className="fm-footer-col">
					<Link to="/" hash="features">
						Features
					</Link>
					<Link to="/changelog">Changelog</Link>
					<Link to="/early-access">Hosted early access</Link>
				</div>
				<div className="fm-footer-col">
					<Link to="/self-hosting">Self-hosting</Link>
					<a href={links.home}>Source on GitHub</a>
					<a href={links.docs}>Documentation</a>
				</div>
				<div className="fm-footer-col">
					<Link to="/about">About</Link>
					<Link to="/privacy">Privacy</Link>
					<Link to="/terms">Terms</Link>
					<Link to="/delete-account">Delete your account</Link>
				</div>
			</div>
			<div className="fm-container fm-footer-base">
				<span className="fm-mono">© 2026 Profico · {LICENSE_NAME}</span>
				<span>
					Free to use, change and self-host. Read{" "}
					<a
						href={links.license}
						style={{ color: "var(--mut)", textDecoration: "underline" }}
					>
						our license
					</a>
					.
				</span>
			</div>
			<WheatField />
		</footer>
	);
}

/** A public page: the sheet, the header, the page, the footer. */
export function SitePage({ children }: { children: ReactNode }) {
	const pageRef = useRef<HTMLDivElement>(null);
	useEmSheen(pageRef);
	return (
		<div ref={pageRef} className="fm-site fm-page">
			<SiteHeader />
			<main className="fm-page-main">{children}</main>
			<SiteFooter />
		</div>
	);
}
