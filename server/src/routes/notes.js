import express from 'express';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Get all notes for the user
router.get('/', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // Sort notes by updatedAt in descending order (newest first)
    const sortedNotes = user.notes.sort((a, b) => 
      new Date(b.updatedAt) - new Date(a.updatedAt)
    );
    
    res.json({ notes: sortedNotes });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new note
router.post('/', protect, async (req, res) => {
  try {
    const { title, content, tags = [] } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const newNote = {
      title,
      content,
      tags,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    user.notes.push(newNote);
    await user.save();
    
    const savedNote = user.notes[user.notes.length - 1];
    res.status(201).json({ note: savedNote });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update a note
router.put('/:noteId', protect, async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const note = user.notes.id(req.params.noteId);
    if (!note) return res.status(404).json({ message: 'Note not found' });
    
    if (title !== undefined) note.title = title;
    if (content !== undefined) note.content = content;
    if (tags !== undefined) note.tags = tags;
    note.updatedAt = new Date();
    
    await user.save();
    
    res.json({ note });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a note
router.delete('/:noteId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const noteIndex = user.notes.findIndex(note => note._id.toString() === req.params.noteId);
    if (noteIndex === -1) return res.status(404).json({ message: 'Note not found' });
    
    user.notes.splice(noteIndex, 1);
    await user.save();
    
    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Search notes by title or content
router.get('/search', protect, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ message: 'Search query required' });
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const searchTerm = q.toLowerCase();
    const filteredNotes = user.notes.filter(note => 
      note.title.toLowerCase().includes(searchTerm) || 
      note.content.toLowerCase().includes(searchTerm) ||
      note.tags.some(tag => tag.toLowerCase().includes(searchTerm))
    );
    
    res.json({ notes: filteredNotes });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;