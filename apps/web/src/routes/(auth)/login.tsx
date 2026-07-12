import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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

const loginSchema = z.object({
	email: z.email(),
	password: z.string().min(8),
});

export const Route = createFileRoute("/(auth)/login")({
	validateSearch: z.object({
		redirect: z.string().optional(),
		email: z.string().optional(),
		org: z.string().optional(),
		orgSlug: z.string().optional(),
		role: z.string().optional(),
	}),
	component: LoginPage,
});

function LoginPage() {
	const navigate = useNavigate();
	const { redirect, ...inviteContext } = Route.useSearch();
	const form = useForm<z.infer<typeof loginSchema>>({
		resolver: zodResolver(loginSchema),
		defaultValues: { email: "", password: "" },
	});

	// Where Google sends the user back after auth. Carry the invite context
	// (org/orgSlug/role/email) along as query params so an invited user lands in
	// the same place the email flow would take them.
	const callbackURL = buildCallbackURL(redirect ?? "/", inviteContext);

	const onSubmit = async (values: z.infer<typeof loginSchema>) => {
		const { error } = await authClient.signIn.email(values);
		if (error) {
			toast.error(error.message ?? "Could not sign in");
			return;
		}
		await navigate({ to: redirect ?? "/", search: inviteContext });
	};

	return (
		<AuthSplitPanel tagline="Every hour, accounted for — without the friction.">
			<h1 className="font-display text-xl">Welcome back</h1>
			<p className="mt-1 text-[13.5px] text-muted-foreground">
				Sign in to your workspace to continue.
			</p>
			<div className="mt-6">
				<GoogleSignInButton
					label="Sign in with Google"
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
						name="email"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Email</FormLabel>
								<FormControl>
									<Input type="email" autoComplete="email" {...field} />
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
										autoComplete="current-password"
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
						Sign in
					</Button>
				</form>
			</Form>
			<p className="mt-6 text-center text-sm text-muted-foreground">
				New here?{" "}
				<Link
					to="/register"
					search={{ redirect, ...inviteContext }}
					className="font-semibold text-primary"
				>
					Create an account
				</Link>
			</p>
		</AuthSplitPanel>
	);
}
