import { TaskDetailView } from "@/components/task-detail";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TaskDetailView taskId={id} />;
}
