import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/page1')({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Page 1</div>;
}
