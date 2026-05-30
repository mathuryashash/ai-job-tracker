import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import axios from 'axios';

interface Application {
  id: string;
  companyName: string;
  positionTitle: string;
  status: string;
  jobUrl?: string;
  createdAt: string;
}

const columns = [
  { id: 'todo', title: 'To Do', color: 'bg-gray-100' },
  { id: 'applied', title: 'Applied', color: 'bg-blue-100' },
  { id: 'interviewing', title: 'Interviewing', color: 'bg-yellow-100' },
  { id: 'offer', title: 'Offer', color: 'bg-green-100' },
  { id: 'rejected', title: 'Rejected', color: 'bg-red-100' },
];

export default function JobTracker() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [newApp, setNewApp] = useState({
    companyName: '',
    positionTitle: '',
    jobUrl: '',
  });

  useEffect(() => {
    fetchApplications();
  }, []);

  const fetchApplications = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/applications');
      setApplications(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch applications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const { draggableId, destination } = result;
    const newStatus = destination.droppableId;

    setApplications((prev) =>
      prev.map((app) =>
        app.id === draggableId ? { ...app, status: newStatus } : app
      )
    );

    setSavingIds((prev) => new Set(prev).add(draggableId));
    try {
      await axios.post(`/api/applications/${draggableId}/move`, { status: newStatus });
    } catch (error) {
      console.error('Failed to update status:', error);
      fetchApplications();
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(draggableId);
        return next;
      });
    }
  };

  const handleCreateApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await axios.post('/api/applications', {
        companyName: newApp.companyName,
        positionTitle: newApp.positionTitle,
        jobUrl: newApp.jobUrl || undefined,
      });
      setShowModal(false);
      setNewApp({ companyName: '', positionTitle: '', jobUrl: '' });
      fetchApplications();
    } catch (error) {
      console.error('Failed to create application:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this application?')) return;

    try {
      await axios.delete(`/api/applications/${id}`);
      fetchApplications();
    } catch (error) {
      console.error('Failed to delete application:', error);
    }
  };

  const getApplicationsByStatus = (status: string) =>
    applications.filter((app) => app.status === status);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Job Tracker</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          + Add Application
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-5 md:overflow-visible md:pb-0">
            {columns.map((column) => (
              <Droppable key={column.id} droppableId={column.id}>
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`${column.color} rounded-lg p-4 min-h-[500px] w-[280px] flex-shrink-0 snap-start md:w-auto md:flex-shrink`}
                  >
                    <h2 className="font-semibold text-gray-900 mb-4">
                      {column.title}
                      <span className="ml-2 text-sm text-gray-500">
                        ({getApplicationsByStatus(column.id).length})
                      </span>
                    </h2>
                    <div className="space-y-3">
                      {getApplicationsByStatus(column.id).map((app, index) => (
                        <Draggable
                          key={app.id}
                          draggableId={app.id}
                          index={index}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`bg-white rounded-lg shadow-sm p-4 mb-3 cursor-grab hover:shadow-md transition-shadow ${
                                snapshot.isDragging ? 'opacity-50' : ''
                              } ${savingIds.has(app.id) ? 'ring-2 ring-primary-300 ring-offset-1' : ''}`}
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex-1 min-w-0 mr-2">
                                  <p className="font-medium text-gray-900 truncate">
                                    {app.positionTitle}
                                  </p>
                                  <p className="text-sm text-gray-600 truncate">
                                    {app.companyName}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {savingIds.has(app.id) && (
                                    <div
                                      className="w-3 h-3 border border-primary-500 border-t-transparent rounded-full animate-spin"
                                      aria-label="Saving…"
                                    />
                                  )}
                                  <button
                                    onClick={() => handleDelete(app.id)}
                                    className="text-gray-400 hover:text-red-500 w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center"
                                    aria-label={`Delete ${app.positionTitle} at ${app.companyName}`}
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                              {app.jobUrl && (
                                <a
                                  href={app.jobUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary-600 hover:underline"
                                >
                                  View Job
                                </a>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </DragDropContext>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              New Application
            </h2>
            <form onSubmit={handleCreateApplication}>
              <div className="mb-4">
                <label className="label">Company Name</label>
                <input
                  type="text"
                  value={newApp.companyName}
                  onChange={(e) =>
                    setNewApp({ ...newApp, companyName: e.target.value })
                  }
                  className="input"
                  required
                  disabled={submitting}
                />
              </div>
              <div className="mb-4">
                <label className="label">Position Title</label>
                <input
                  type="text"
                  value={newApp.positionTitle}
                  onChange={(e) =>
                    setNewApp({ ...newApp, positionTitle: e.target.value })
                  }
                  className="input"
                  required
                  disabled={submitting}
                />
              </div>
              <div className="mb-4">
                <label className="label">Job URL (optional)</label>
                <input
                  type="url"
                  value={newApp.jobUrl}
                  onChange={(e) =>
                    setNewApp({ ...newApp, jobUrl: e.target.value })
                  }
                  className="input"
                  disabled={submitting}
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={submitting}
                >
                  {submitting && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {submitting ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
