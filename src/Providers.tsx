import { type RegisteredRouter, RouterProvider } from '@tanstack/react-router';

export function Providers({ router }: { router: RegisteredRouter }) {
  return <RouterProvider router={router} />;
}
