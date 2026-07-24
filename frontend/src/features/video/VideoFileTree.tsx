import { useEffect, useState } from 'react';

import { formatTimestamp } from './sync';
import type { VideoNote } from './types';
import { useVideoLab } from './VideoLabContext';
import { VsCodeModal } from './VsCodeModal';

type VideoFileTreeProps = {
  compact?: boolean;
  onRequestClose?: () => void;
};

type NoteModalState =
  | { mode: 'create' }
  | { mode: 'edit'; note: VideoNote }
  | null;

export function VideoFileTree({
  compact = false,
  onRequestClose,
}: VideoFileTreeProps) {
  const {
    state,
    openLibraryItem,
    removeLibraryItem,
    saveNote,
    editNote,
    deleteNote,
  } = useVideoLab();
  const [videosOpen, setVideosOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [noteModal, setNoteModal] = useState<NoteModalState>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!noteModal) {
      return;
    }
    if (noteModal.mode === 'edit') {
      setNoteTitle(noteModal.note.title);
      setNoteText(noteModal.note.text);
      return;
    }
    setNoteTitle('');
    setNoteText('');
  }, [noteModal]);

  const handleOpenVideo = (id: string) => {
    const item = state.library.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    openLibraryItem(item);
    onRequestClose?.();
  };

  const handleSaveNoteModal = () => {
    const title = noteTitle.trim();
    const text = noteText.trim();
    if (!title || !text || !noteModal) {
      return;
    }
    if (noteModal.mode === 'create') {
      const message = saveNote({
        id: createLocalId('note'),
        title,
        text,
        createdAt: new Date().toISOString(),
      });
      if (message) {
        setStatus(message);
        return;
      }
      setStatus('Nota guardada en este navegador.');
    } else {
      editNote(noteModal.note.id, { title, text });
      setStatus('Nota actualizada.');
    }
    setNoteModal(null);
  };

  return (
    <div className={compact ? 'video-tree video-tree-compact' : 'video-tree'}>
      {!compact ? (
        <>
          <p className="explorer-title" id="module-context-title">Módulo activo</p>
          <p className="explorer-name">Video Lab</p>
          <p className="explorer-description">
            Navega una transcripción técnica, toma notas y vuelve al contexto.
          </p>
          <div className="explorer-rule" />
        </>
      ) : null}

      <p className="explorer-title">Explorador</p>

      <div className="video-tree-section" role="tree" aria-label="Videos y notas guardados">
        <div className="video-tree-folder-row">
          <button
            aria-expanded={videosOpen}
            className="video-tree-folder"
            onClick={() => setVideosOpen((open) => !open)}
            type="button"
          >
            <Chevron open={videosOpen} />
            <FolderIcon />
            <span>videos</span>
            <span className="video-tree-count">{state.library.length}</span>
          </button>
        </div>
        {videosOpen ? (
          <ul className="video-tree-children" role="group">
            {state.library.length === 0 ? (
              <li className="video-tree-empty">Sin videos guardados</li>
            ) : (
              state.library.map((item) => (
                <li key={item.id} role="treeitem">
                  <div className="video-tree-item">
                    <button
                      className="video-tree-file"
                      onClick={() => handleOpenVideo(item.id)}
                      title={item.title}
                      type="button"
                    >
                      <FileVideoIcon />
                      <span className="video-tree-label">{item.title}</span>
                    </button>
                    <button
                      aria-label={`Eliminar ${item.title}`}
                      className="video-tree-action"
                      onClick={() => removeLibraryItem(item.id)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        ) : null}

        <div className="video-tree-folder-row">
          <button
            aria-expanded={notesOpen}
            className="video-tree-folder"
            onClick={() => setNotesOpen((open) => !open)}
            type="button"
          >
            <Chevron open={notesOpen} />
            <FolderIcon />
            <span>notes</span>
            <span className="video-tree-count">{state.notes.length}</span>
          </button>
          <button
            aria-label="Nueva nota"
            className="video-tree-add"
            onClick={() => setNoteModal({ mode: 'create' })}
            title="Nueva nota"
            type="button"
          >
            +
          </button>
        </div>
        {notesOpen ? (
          <ul className="video-tree-children" role="group">
            {state.notes.length === 0 ? (
              <li className="video-tree-empty">Sin notas guardadas</li>
            ) : (
              state.notes.map((note) => (
                <li key={note.id} role="treeitem">
                  <div className="video-tree-item">
                    <button
                      className="video-tree-file"
                      onClick={() => setNoteModal({ mode: 'edit', note })}
                      title={note.title}
                      type="button"
                    >
                      <FileNoteIcon />
                      <span className="video-tree-label">{note.title}</span>
                      {note.timestamp !== undefined ? (
                        <span className="video-tree-meta" aria-hidden="true">
                          {formatTimestamp(note.timestamp)}
                        </span>
                      ) : null}
                    </button>
                    <button
                      aria-label={`Eliminar nota ${note.title}`}
                      className="video-tree-action"
                      onClick={() => deleteNote(note.id)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      {status ? (
        <p aria-live="polite" className="video-tree-status">
          {status}
        </p>
      ) : null}

      <p className="explorer-note" style={{ marginTop: '1.1rem' }}>
        Preferencias y guardados sólo en este navegador.
      </p>

      {noteModal ? (
        <VsCodeModal
          confirmDisabled={!noteTitle.trim() || !noteText.trim()}
          confirmLabel={noteModal.mode === 'create' ? 'Guardar nota' : 'Guardar cambios'}
          description={
            noteModal.mode === 'create'
              ? 'Las notas son independientes de los videos guardados.'
              : undefined
          }
          onCancel={() => setNoteModal(null)}
          onConfirm={handleSaveNoteModal}
          title={noteModal.mode === 'create' ? 'Nueva nota' : 'Editar nota'}
        >
          <label className="vsc-field-label" htmlFor="video-note-title">
            Nombre
          </label>
          <input
            className="vsc-field-input"
            id="video-note-title"
            maxLength={200}
            onChange={(event) => setNoteTitle(event.currentTarget.value)}
            value={noteTitle}
          />
          <label className="vsc-field-label" htmlFor="video-note-body">
            Contenido
          </label>
          <textarea
            className="vsc-field-textarea"
            id="video-note-body"
            maxLength={2_000}
            onChange={(event) => setNoteText(event.currentTarget.value)}
            rows={5}
            value={noteText}
          />
          {noteModal.mode === 'edit' ? (
            <button
              className="vsc-modal-button vsc-modal-button-danger"
              onClick={() => {
                deleteNote(noteModal.note.id);
                setNoteModal(null);
              }}
              type="button"
            >
              Eliminar nota
            </button>
          ) : null}
        </VsCodeModal>
      ) : null}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={open ? 'video-tree-chevron open' : 'video-tree-chevron'}
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M6 4.5 10 8 6 11.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" className="video-tree-icon folder" fill="none" viewBox="0 0 16 16">
      <path
        d="M2.5 4.25h3.1l1.1 1.25H13.5v6.5H2.5z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function FileVideoIcon() {
  return (
    <svg aria-hidden="true" className="video-tree-icon" fill="none" viewBox="0 0 16 16">
      <rect height="9" rx="1" stroke="currentColor" strokeWidth="1.2" width="11" x="2.5" y="3.5" />
      <path d="m7 6.2 3 1.8-3 1.8z" fill="currentColor" />
    </svg>
  );
}

function FileNoteIcon() {
  return (
    <svg aria-hidden="true" className="video-tree-icon note" fill="none" viewBox="0 0 16 16">
      <path
        d="M4 2.75h5.2L12 5.55v7.7H4z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path d="M9 2.85v2.9h2.9M6 8.25h4M6 10.5h3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.1" />
    </svg>
  );
}

function createLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
