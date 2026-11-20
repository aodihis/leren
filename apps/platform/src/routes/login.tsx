import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@leren/ui";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { authClient } from "../modules/auth/auth-client";
import { Logo } from "../modules/layout/components/logo";

const CODE_LENGTH = 6;

const emailSchema = z.object({ email: z.email("Enter a valid email address") });

const codeSchema = z.object({
  code: z.string().length(CODE_LENGTH, `Enter the ${CODE_LENGTH}-digit code`),
});

type EmailValues = z.infer<typeof emailSchema>;

type CodeValues = z.infer<typeof codeSchema>;

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession({ query: { disableCookieCache: true } });

    if (data) {
      throw redirect({ to: "/" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const [email, setEmail] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas p-6">
      <div className="flex items-center gap-2.5 text-[15px] leading-[22px] font-semibold">
        <Logo />
        Leren
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-[17px] leading-6">Sign in to Leren</CardTitle>
          <CardDescription>
            {email === null
              ? "Enter your email and we will send you a sign-in code. If you are new, the same code creates your account."
              : `We sent a ${CODE_LENGTH}-digit code to ${email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {email === null ? (
            <EmailStep onCodeSent={setEmail} />
          ) : (
            <CodeStep email={email} onChangeEmail={() => setEmail(null)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface EmailStepProps {
  onCodeSent: (email: string) => void;
}

function EmailStep({ onCodeSent }: EmailStepProps) {
  const form = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });

  async function handleSubmit({ email }: EmailValues) {
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });

    if (error) {
      form.setError("root", { message: error.message ?? "Could not send the code" });

      return;
    }

    onCodeSent(email);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {form.formState.errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        )}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          Send code
        </Button>
      </form>
    </Form>
  );
}

interface CodeStepProps {
  email: string;
  onChangeEmail: () => void;
}

function CodeStep({ email, onChangeEmail }: CodeStepProps) {
  const navigate = useNavigate();

  const form = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });

  async function handleSubmit({ code }: CodeValues) {
    const { data, error } = await authClient.signIn.emailOtp({ email, otp: code });

    if (error) {
      form.setError("root", { message: error.message ?? "That code did not work" });
      form.resetField("code");

      return;
    }

    await navigate({ to: data.user.firstName ? "/" : "/profile" });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {form.formState.errors.root && (
          <Alert variant="destructive">
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        )}
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sign-in code</FormLabel>
              <FormControl>
                <InputOTP
                  maxLength={CODE_LENGTH}
                  containerClassName="justify-center"
                  inputMode="numeric"
                  autoFocus
                  onComplete={() => {
                    if (!form.formState.isSubmitting) {
                      void form.handleSubmit(handleSubmit)();
                    }
                  }}
                  {...field}
                >
                  <InputOTPGroup>
                    {Array.from({ length: CODE_LENGTH }, (_, index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          Verify and continue
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onChangeEmail}>
          Use a different email
        </Button>
      </form>
    </Form>
  );
}
