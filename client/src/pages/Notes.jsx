import React, { useState, useEffect, useCallback } from 'react';
import { getNotes, createNote, updateNote, deleteNote, searchNotes } from '../lib/api.js';
import Sidebar from '../components/Sidebar.jsx';

export default function Notes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    tags: ''
  });

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchNotes(searchQuery);
        setSearchResults(results);
      } catch (error) {
        console.error('Error searching notes:', error);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Load notes on component mount
  useEffect(() => {
    loadNotes();
  }, []);

  // handle modal enter animation
  useEffect(() => {
    let t;
    if (showForm) {
      // mount then animate
      t = setTimeout(() => setModalVisible(true), 15);
    } else {
      setModalVisible(false);
    }
    return () => clearTimeout(t);
  }, [showForm]);

  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      handleSearch();
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const loadNotes = async () => {
    try {
      setLoading(true);
      const notesData = await getNotes();
      setNotes(notesData);
    } catch (error) {
      console.error('Error loading notes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      loadNotes();
      return;
    }
    try {
      const results = await searchNotes(searchQuery);
      setNotes(results);
    } catch (error) {
      console.error('Error searching notes:', error);
    }
  }, [searchQuery]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { title, content, tags } = formData;
      const tagsArray = tags.split(',').map(tag => tag.trim()).filter(Boolean);
      
      if (editingNote) {
        await updateNote(editingNote._id, title, content, tagsArray);
      } else {
        await createNote(title, content, tagsArray);
      }
      
      setFormData({ title: '', content: '', tags: '' });
        // animate close
        setModalVisible(false);
        setTimeout(() => setShowForm(false), 180);
      setEditingNote(null);
      loadNotes();
    } catch (error) {
      console.error('Error saving note:', error);
    }
  };

  const handleEdit = (note) => {
    setEditingNote(note);
    setFormData({
      title: note.title,
      content: note.content,
      tags: note.tags.join(', ')
    });
    setShowForm(true);
  };

  const handleDelete = async (noteId) => {
    if (!confirm('Are you sure you want to delete this note?')) return;
    try {
      await deleteNote(noteId);
      loadNotes();
    } catch (error) {
      console.error('Error deleting note:', error);
    }
  };

  const cancelForm = () => {
    setFormData({ title: '', content: '', tags: '' });
    setModalVisible(false);
    setTimeout(() => setShowForm(false), 180);
    setEditingNote(null);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Trading Notes</h1>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowForm(true)}
              className="btn-primary"
            >
              New Note
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="flex gap-2 max-w-md">
            <input
              type="text"
              placeholder="Search notes by title, content, or tags..."
              className="input flex-1"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button onClick={clearSearch} className="btn-secondary">Clear</button>
          </div>
        </div>

        {/* Note Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div className={`bg-white rounded-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto transform transition-all duration-150 ${modalVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
              <h2 className="text-xl font-semibold mb-4">
                {editingNote ? 'Edit Note' : 'Create New Note'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Title</label>
                  <input
                    type="text"
                    className="input w-full"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                    placeholder="Enter note title..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Content</label>
                  <textarea
                    className="input w-full"
                    rows="8"
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    required
                    placeholder="Write your trading thoughts, analysis, or observations..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    className="input w-full"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    placeholder="e.g., NIFTY, analysis, swing-trade, earnings"
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <button type="submit" className="btn-primary">
                    {editingNote ? 'Update' : 'Create'} Note
                  </button>
                  <button type="button" onClick={cancelForm} className="btn-secondary">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Notes List */}
        {loading ? (
          <div className="text-center py-8">
            <div className="text-gray-500">Loading notes...</div>
          </div>
        ) : (searchResults || notes).length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-4">
              {searchQuery ? 'No notes found matching your search.' : 'No notes yet. Create your first trading note!'}
            </div>
            {!searchQuery && (
              <button onClick={() => setShowForm(true)} className="btn-primary">
                Create Note
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {(searchResults || notes).map((note, idx) => (
              <div
                key={note._id}
                className="border rounded-xl p-4 bg-white shadow-sm hover:shadow-lg transition transform hover:-translate-y-1"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-lg">{note.title}</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(note)}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(note._id)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="prose prose-sm max-w-none mb-3">
                  <div className="whitespace-pre-wrap text-gray-700">
                    {note.content}
                  </div>
                </div>

                {note.tags && note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {note.tags.map((tag, index) => (
                      <span 
                        key={index} 
                        className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex justify-between text-xs text-gray-500">
                  <span>Created: {formatDate(note.createdAt)}</span>
                  {note.updatedAt !== note.createdAt && (
                    <span>Updated: {formatDate(note.updatedAt)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}