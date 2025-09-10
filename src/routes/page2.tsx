import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/page2')({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Page 2</div>;
}
