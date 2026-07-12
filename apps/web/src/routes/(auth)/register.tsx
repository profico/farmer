import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AuthSplitPanel } from "#/components/auth-split-panel.tsx";
import {
	buildCallbackURL,
	GoogleSignInButton,
} from "#/components/google-sign-in-button.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { Input } from "#/components/ui/input.tsx";
import { authClient } from "#/lib/auth-client.ts";

const registerSchema = z.object({
	name: z.string().min(1, "Name is required"),
	email: z.email(),
	password: z.string().min(8, "Must be at least 8 characters"),
});

const FEATURES = [
	"Day, week & month views",
	"Recurring blocks",
	"Project & billing reports",
];

export const Route = createFileRoute("/(auth)/register")({
	validateSearch: z.object({
		redirect: z.string().optional(),
		email: z.string().optional(),
		org: z.string().optional(),
		orgSlug: z.string().optional(),
		role: z.string().optional(),
	}),
	component: RegisterPage,
});

function RegisterPage() {
	const navigate = useNavigate();
	const { redirect, email, ...inviteContext } = Route.useSearch();
	const form = useForm<z.infer<typeof registerSchema>>({
		resolver: zodResolver(registerSchema),
		defaultValues: { name: "", email: email ?? "", password: "" },
	});

	// Google (as identity) both signs up and signs in — a first-time Google user
	// gets an account + workspace via the same databaseHook as email signup.
	const callbackURL = buildCallbackURL(redirect ?? "/", {
		email,
		...inviteContext,
	});

	const onSubmit = async (values: z.infer<typeof registerSchema>) => {
		const { error } = await authClient.signUp.email(values);
		if (error) {
			toast.error(error.message ?? "Could not create account");
			return;
		}
		await navigate({
			to: redirect ?? "/",
			search: { email, ...inviteContext },
		});
	};

	return (
		<AuthSplitPanel
			tagline="Start tracking in under a minute."
			brandContent={
				<div className="mt-5 flex flex-col gap-2.5">
					{FEATURES.map((feature) => (
						<div
							key={feature}
							className="flex items-center gap-2.5 text-[13px] text-[#c9c2d6]"
						>
							<Check className="size-4 shrink-0 text-[#c19bf0]" />
							{feature}
						</div>
					))}
				</div>
			}
		>
			<h1 className="font-display text-xl">Create your account</h1>
			<p className="mt-1 text-[13.5px] text-muted-foreground">
				Set up your workspace to start tracking time.
			</p>
			<div className="mt-6">
				<GoogleSignInButton
					label="Sign up with Google"
					callbackURL={callbackURL}
				/>
			</div>
			<div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
				<span className="h-px flex-1 bg-border" />
				or
				<span className="h-px flex-1 bg-border" />
			</div>
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
					<FormField
						control={form.control}
						name="name"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Full name</FormLabel>
								<FormControl>
									<Input autoComplete="name" {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="email"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Work email</FormLabel>
								<FormControl>
									<Input
										type="email"
										autoComplete="email"
										readOnly={!!email}
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="password"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Password</FormLabel>
								<FormControl>
									<Input
										type="password"
										autoComplete="new-password"
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<Button
						type="submit"
						className="mt-1 w-full"
						disabled={form.formState.isSubmitting}
					>
						Create account
					</Button>
				</form>
			</Form>
			<p className="mt-6 text-center text-sm text-muted-foreground">
				Already have an account?{" "}
				<Link
					to="/login"
					search={{ redirect, email, ...inviteContext }}
					className="font-semibold text-primary"
				>
					Sign in
				</Link>
			</p>
		</AuthSplitPanel>
	);
}
