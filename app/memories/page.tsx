'use client';

import { useCanvasStore } from '@/lib/store';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { listBackups, restoreBackup } from '@/lib/db';

export default function MemoriesPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const setUserContext = useCanvasStore(state => state.setUserContext);

  const folders = useCanvasStore(state => state.folders);
  const universeLibrary = useCanvasStore(state => state.universeLibrary);
  const activeUniverseIds = useCanvasStore(state => state.activeUniverseIds);
  const createFolder = useCanvasStore(state => state.createFolder);
  const renameFolder = useCanvasStore(state => state.renameFolder);
  const deleteFolder = useCanvasStore(state => state.deleteFolder);
  const moveUniverseToFolder = useCanvasStore(state => state.moveUniverseToFolder);
  const loadUniverse = useCanvasStore(state => state.loadUniverse);
  const deleteConversation = useCanvasStore(state => state.deleteConversation);
  const deleteUniverseById = useCanvasStore(state => state.deleteUniverseById);
  const renameUniverse = useCanvasStore(state => state.renameUniverse);
  const toggleUniverseActive = useCanvasStore(state => state.toggleUniverseActive);
  const atomizeUniverse = useCanvasStore(state => state.atomizeUniverse);
  const getL1Nodes = useCanvasStore(state => state.getL1Nodes);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedColor, setSelectedColor] = useState('#8B5CF6');

  // 🎯 Universe selection state
  const [selectedUniverseId, setSelectedUniverseId] = useState<string | null>(null);

  // ✏️ Universe rename state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    universeId: string;
  } | null>(null);
  const [editingUniverseId, setEditingUniverseId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // 🔄 Recovery UI state
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [backups, setBackups] = useState<Array<{id: string; timestamp: number; label: string; date: string}>>([]);

  // 🔬 Atomize UI state
  const [showAtomizeModal, setShowAtomizeModal] = useState(false);
  const [isAtomizing, setIsAtomizing] = useState(false);
  const [atomizeProgress, setAtomizeProgress] = useState({
    current: 0,
    total: 0,
    status: '',
    errors: [] as string[]
  });

  // 🚀 LOAD DATA FROM LOCALSTORAGE WHEN PAGE OPENS
  useEffect(() => {
    // Wait for the session to resolve so we scope persistence to the signed-in
    // account before loading (never the anonymous namespace by mistake).
    if (sessionStatus === 'loading') return;
    // 🔒 BETA-06: point persistence at the signed-in account before loading.
    // setUserContext owns the reset + rehydration (page-agnostic): it
    // synchronously drops the previous account's in-memory library and
    // reloads the target namespace, so saves/autosaves can never run with
    // another account's in-memory data. Calling loadFromLocalStorage here too
    // would double-load; the hydration triggered by setUserContext populates
    // the library this page subscribes to.
    setUserContext(session?.user?.id ?? null);
    console.log('📚 MEMORIES PAGE LOADED:', new Date().toLocaleTimeString());

    // Expand all folders by default
    const folderIds = Object.keys(useCanvasStore.getState().folders);
    setExpandedFolders(new Set(folderIds));

    // Load available backups
    listBackups().then(setBackups);
  }, [sessionStatus, session?.user?.id, setUserContext]);

  const toggleFolder = (folderId: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      createFolder(newFolderName.trim(), selectedColor);
      setNewFolderName('');
      setShowNewFolderModal(false);

      // Auto-expand the new folder
      setTimeout(() => {
        const newFolderId = `folder-${Date.now()}`;
        setExpandedFolders(prev => new Set(prev).add(newFolderId));
      }, 100);
    }
  };

  const handleRenameFolder = (folderId: string) => {
    const folder = folders[folderId];
    const newName = prompt('Rename folder:', folder.name);
    if (newName && newName.trim()) {
      renameFolder(folderId, newName.trim());
    }
  };

  const handleDeleteFolder = (folderId: string) => {
    if (folderId === 'default') {
      alert('Cannot delete Uncategorized folder');
      return;
    }

    const folder = folders[folderId];
    if (confirm(`Delete folder "${folder.name}"? Universes will move to Uncategorized.`)) {
      deleteFolder(folderId);
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!confirm('Restore from this backup? Your current data will be replaced.')) {
      return;
    }

    const data = await restoreBackup(backupId);
    if (data) {
      // Update Zustand store with restored data
      useCanvasStore.setState({
        universeLibrary: data.universeLibrary || {},
        folders: data.folders || {},
        activatedConversations: data.activatedConversations || [],
        nexuses: [],
        nodes: {},
        activeUniverseId: null,
      });

      // Save restored data
      useCanvasStore.getState().saveToLocalStorage();

      setShowRecoveryModal(false);
      alert('✅ Backup restored successfully!');

      // Reload the page to reflect changes
      window.location.reload();
    } else {
      alert('❌ Failed to restore backup');
    }
  };

  // ✏️ RENAME HANDLERS
  const handleContextMenu = (e: React.MouseEvent, universeId: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      universeId: universeId
    });
  };

  const handleRename = (universeId: string, currentTitle: string) => {
    setEditingUniverseId(universeId);
    setEditTitle(currentTitle);
    setContextMenu(null);
  };

  const handleSaveRename = (universeId: string) => {
    const success = renameUniverse(universeId, editTitle);

    if (success) {
      setEditingUniverseId(null);
      setEditTitle('');
    }
  };

  const handleCancelRename = () => {
    setEditingUniverseId(null);
    setEditTitle('');
  };

  // 🔬 ATOMIZE HANDLERS
  const handleAtomizeConfirm = async () => {
    if (!selectedUniverseId) return;

    setShowAtomizeModal(false);
    setIsAtomizing(true);
    setAtomizeProgress({ current: 0, total: 0, status: 'Starting...', errors: [] });

    try {
      const result = await atomizeUniverse(selectedUniverseId, (current, total, status, errors) => {
        // Update progress in real-time
        setAtomizeProgress({ current, total, status, errors });
      });

      if (result.success) {
        const successCount = result.newUniverseIds.length;
        const failCount = result.errors.length;

        let message = `✅ Atomization complete!\n\n`;
        message += `Created: ${successCount} new universes\n`;

        if (failCount > 0) {
          message += `Failed: ${failCount} universes\n\n`;
          message += `Errors:\n${result.errors.join('\n')}`;
        }

        message += `\n\nNew universes are in the "Atomized" folder.`;
        alert(message);

        // Deselect the universe
        setSelectedUniverseId(null);
      } else {
        alert(`❌ Failed to atomize universe: ${result.error}`);
      }
    } catch (error) {
      alert(`❌ Error during atomization: ${error}`);
    } finally {
      setIsAtomizing(false);
      setAtomizeProgress({ current: 0, total: 0, status: '', errors: [] });
    }
  };

  // Close context menu when clicking anywhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Group universes by folder
  const universesByFolder: { [folderId: string]: typeof universeLibrary } = {};
  Object.entries(universeLibrary).forEach(([universeId, universeData]) => {
    const folderId = universeData.folderId || 'default';
    if (!universesByFolder[folderId]) {
      universesByFolder[folderId] = {};
    }
    universesByFolder[folderId][universeId] = universeData;
  });

  // 🔍 DIAGNOSTIC: Log folder grouping
  console.log('📁 ==========================================');
  console.log('📁 MEMORIES PAGE - Universe Grouping');
  console.log('📁 Total universes in library:', Object.keys(universeLibrary).length);
  console.log('📁 Total folders:', Object.keys(folders).length);
  Object.entries(folders).forEach(([id, folder]) => {
    const count = Object.keys(universesByFolder[id] || {}).length;
    console.log(`📁   - ${folder.name} [${id}]: ${count} universes`);
    if (count > 0) {
      Object.entries(universesByFolder[id] || {}).forEach(([uId, uData]) => {
        console.log(`📁     • ${uData.title.substring(0, 50)}`);
      });
    }
  });

  // Check for orphaned universes (folderId doesn't match any folder)
  const orphanedUniverses = Object.entries(universeLibrary).filter(([id, data]) => {
    const folderId = data.folderId || 'default';
    return !folders[folderId];
  });
  if (orphanedUniverses.length > 0) {
    console.warn('📁 ⚠️ ORPHANED UNIVERSES (folderId not in folders):', orphanedUniverses.length);
    orphanedUniverses.forEach(([id, data]) => {
      console.warn(`📁   • ${data.title} - folderId: "${data.folderId}"`);
    });
  }

  // Check if there are folders in universesByFolder that don't exist in folders
  const extraFolderIds = Object.keys(universesByFolder).filter(id => !folders[id]);
  if (extraFolderIds.length > 0) {
    console.warn('📁 ⚠️ UNIVERSES GROUPED UNDER NON-EXISTENT FOLDERS:', extraFolderIds);
    extraFolderIds.forEach(folderId => {
      console.warn(`📁   • Folder ID "${folderId}": ${Object.keys(universesByFolder[folderId]).length} universes`);
    });
  }

  console.log('📁 ==========================================');

  const folderColors = ['#8B5CF6', '#00FFD4', '#FFD700', '#10B981', '#EF4444', '#F59E0B'];

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#050A1E',
      padding: '40px 20px'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '40px'
        }}>
          <div>
            <h1 style={{
              color: '#00FFD4',
              fontSize: '48px',
              margin: 0
            }}>
              🧠 Memories
            </h1>
            {activeUniverseIds.length > 0 && (
              <div style={{
                marginTop: '8px',
                fontSize: '14px',
                color: '#00FFD4',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{
                  padding: '4px 12px',
                  backgroundColor: 'rgba(0, 255, 212, 0.2)',
                  borderRadius: '12px',
                  fontWeight: 'bold'
                }}>
                  {activeUniverseIds.length} on Canvas
                </span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button
              onClick={() => setShowAtomizeModal(true)}
              disabled={!selectedUniverseId}
              style={{
                padding: '12px 24px',
                backgroundColor: selectedUniverseId ? '#10B981' : '#4B5563',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: selectedUniverseId ? 'pointer' : 'not-allowed',
                opacity: selectedUniverseId ? 1 : 0.6,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              🔬 Atomize
            </button>

            <button
              onClick={() => setShowRecoveryModal(true)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#EF4444',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              🔄 Recover Data
            </button>

            <button
              onClick={() => setShowNewFolderModal(true)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#8B5CF6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              + New Folder
            </button>
          </div>
        </div>

        {/* Folders */}
        {Object.values(folders)
          .sort((a, b) => {
            // Default folder always last
            if (a.id === 'default') return 1;
            if (b.id === 'default') return -1;
            return a.createdAt - b.createdAt;
          })
          .map(folder => {
            const folderUniverses = universesByFolder[folder.id] || {};
            const count = Object.keys(folderUniverses).length;
            const isExpanded = expandedFolders.has(folder.id);

            return (
              <div key={folder.id} style={{ marginBottom: '24px' }}>
                {/* Folder Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '16px',
                    backgroundColor: '#0A1628',
                    border: `2px solid ${folder.color}`,
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                  onClick={() => toggleFolder(folder.id)}
                >
                  <span style={{ fontSize: '20px', marginRight: '12px' }}>
                    {isExpanded ? '📂' : '📁'}
                  </span>

                  <span style={{
                    color: folder.color,
                    fontSize: '20px',
                    fontWeight: 'bold',
                    flex: 1
                  }}>
                    {folder.name} ({count})
                  </span>

                  {folder.id !== 'default' && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'relative'
                      }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const action = prompt('Rename (r) or Delete (d)?', 'r');
                          if (action === 'r') handleRenameFolder(folder.id);
                          if (action === 'd') handleDeleteFolder(folder.id);
                        }}
                        style={{
                          padding: '8px 12px',
                          backgroundColor: 'transparent',
                          color: folder.color,
                          border: 'none',
                          fontSize: '18px',
                          cursor: 'pointer'
                        }}
                      >
                        ⋯
                      </button>
                    </div>
                  )}
                </div>

                {/* Universe Cards */}
                {isExpanded && (
                  <div style={{
                    marginTop: '12px',
                    marginLeft: '32px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '16px'
                  }}>
                    {Object.entries(folderUniverses)
                      .sort(([,a], [,b]) => (a.createdAt || 0) - (b.createdAt || 0))
                      .map(([universeId, universeData]) => {
                        const isSelected = selectedUniverseId === universeId;
                        const isActive = activeUniverseIds.includes(universeId);
                        // Determine border color and style based on state
                        let borderColor = '#8B5CF6'; // Default purple
                        let borderWidth = '2px';
                        let boxShadow = 'none';
                        let backgroundColor = '#0A1628';

                        if (isSelected) {
                          borderColor = '#FFD700'; // Gold for selected
                          borderWidth = '3px';
                          boxShadow = '0 0 20px rgba(255, 215, 0, 0.4)';
                          backgroundColor = 'rgba(255, 215, 0, 0.05)'; // Subtle gold tint
                        } else if (isActive) {
                          borderColor = '#00FFD4'; // Cyan for active on canvas
                          boxShadow = '0 0 20px rgba(0, 255, 212, 0.3)';
                        }

                        return (
                        <div
                          key={universeId}
                          onClick={() => setSelectedUniverseId(universeId)}
                          onContextMenu={(e) => handleContextMenu(e, universeId)}
                          style={{
                            backgroundColor,
                            border: `${borderWidth} solid ${borderColor}`,
                            borderRadius: '8px',
                            padding: '16px',
                            position: 'relative',
                            boxShadow,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          {/* Title - editable or static */}
                          {editingUniverseId === universeId ? (
                            <div
                              style={{ position: 'relative', marginBottom: '8px' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value.slice(0, 80))}
                                onBlur={() => handleSaveRename(universeId)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveRename(universeId);
                                  if (e.key === 'Escape') handleCancelRename();
                                }}
                                autoFocus
                                style={{
                                  width: '100%',
                                  padding: '8px',
                                  fontSize: '16px',
                                  fontWeight: 'bold',
                                  backgroundColor: '#050A1E',
                                  color: '#00FFD4',
                                  border: '2px solid #00FFD4',
                                  borderRadius: '6px',
                                  outline: 'none'
                                }}
                              />
                              <div style={{
                                position: 'absolute',
                                bottom: '-18px',
                                right: '4px',
                                fontSize: '10px',
                                color: editTitle.length > 80 ? '#EF4444' : 'rgba(255, 255, 255, 0.4)'
                              }}>
                                {editTitle.length}/80
                              </div>
                            </div>
                          ) : (
                            <h3 style={{
                              color: '#00FFD4',
                              fontSize: '16px',
                              marginBottom: '8px',
                              wordBreak: 'break-word'
                            }}>
                              {universeData.title}
                            </h3>
                          )}

                          <div style={{
                            color: '#6B7280',
                            fontSize: '12px',
                            marginBottom: '12px'
                          }}>
                            <div>{universeData.nexuses.length} nexuses</div>
                            <div>{Object.keys(universeData.nodes).length} nodes</div>
                            <div>Created: {new Date(universeData.createdAt || universeData.lastModified).toLocaleDateString()}</div>
                          </div>

                          {/* Folder Selector */}
                          <select
                            value={universeData.folderId || 'default'}
                            onChange={(e) => moveUniverseToFolder(universeId, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: '100%',
                              padding: '8px',
                              marginBottom: '12px',
                              backgroundColor: '#050A1E',
                              color: '#E5E7EB',
                              border: '1px solid #4B5563',
                              borderRadius: '4px',
                              fontSize: '12px'
                            }}
                          >
                            {Object.values(folders).map(f => (
                              <option key={f.id} value={f.id}>
                                📁 {f.name}
                              </option>
                            ))}
                          </select>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                loadUniverse(universeId);
                                router.push('/chat');
                              }}
                              style={{
                                flex: 1,
                                padding: '10px',
                                backgroundColor: '#8B5CF6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                fontWeight: 'bold',
                                cursor: 'pointer'
                              }}
                            >
                              Open
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Delete "${universeData.title}"?`)) {
                                  deleteUniverseById(universeId);
                                }
                              }}
                              style={{
                                padding: '10px 14px',
                                backgroundColor: 'transparent',
                                color: '#EF4444',
                                border: '2px solid #EF4444',
                                borderRadius: '6px',
                                cursor: 'pointer'
                              }}
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: '#0A1628',
            border: '2px solid #8B5CF6',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '400px',
            width: '90%'
          }}>
            <h2 style={{ color: '#00FFD4', marginBottom: '16px' }}>
              Create New Folder
            </h2>

            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleCreateFolder();
                }
              }}
              placeholder="Folder name..."
              autoFocus
              style={{
                width: '100%',
                padding: '12px',
                marginBottom: '16px',
                backgroundColor: '#050A1E',
                color: 'white',
                border: '2px solid #4B5563',
                borderRadius: '8px',
                fontSize: '16px'
              }}
            />

            <div style={{ marginBottom: '24px' }}>
              <div style={{ color: '#E5E7EB', marginBottom: '8px' }}>
                Choose color:
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {folderColors.map(color => (
                  <div
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    style={{
                      width: '40px',
                      height: '40px',
                      backgroundColor: color,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      border: selectedColor === color ? '3px solid white' : 'none'
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: newFolderName.trim() ? '#00FFD4' : '#4B5563',
                  color: '#050A1E',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  cursor: newFolderName.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                Create
              </button>

              <button
                onClick={() => {
                  setShowNewFolderModal(false);
                  setNewFolderName('');
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: 'transparent',
                  color: '#8B5CF6',
                  border: '2px solid #8B5CF6',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recovery Modal */}
      {showRecoveryModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: '#0A1628',
            border: '2px solid #EF4444',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <h2 style={{ color: '#EF4444', marginBottom: '16px' }}>
              🔄 Recover Lost Data
            </h2>

            <p style={{ color: '#E5E7EB', marginBottom: '24px' }}>
              Restore your universes from an automatic backup snapshot.
              Astryon creates backups every 5 saves.
            </p>

            {backups.length === 0 ? (
              <div style={{
                color: '#9CA3AF',
                textAlign: 'center',
                padding: '40px 20px'
              }}>
                No backups available yet.
                <br/>
                Backups are created automatically as you save universes.
              </div>
            ) : (
              <div style={{ marginBottom: '24px' }}>
                {backups.map(backup => (
                  <div
                    key={backup.id}
                    style={{
                      backgroundColor: '#050A1E',
                      border: '1px solid #4B5563',
                      borderRadius: '8px',
                      padding: '16px',
                      marginBottom: '12px'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ color: '#00FFD4', fontWeight: 'bold', marginBottom: '4px' }}>
                          {backup.label === 'auto' ? '📦 Auto Backup' : backup.label}
                        </div>
                        <div style={{ color: '#9CA3AF', fontSize: '14px' }}>
                          {backup.date}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRestoreBackup(backup.id)}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#00FFD4',
                          color: '#050A1E',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowRecoveryModal(false)}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: 'transparent',
                color: '#EF4444',
                border: '2px solid #EF4444',
                borderRadius: '8px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Atomize Preview Modal */}
      {showAtomizeModal && selectedUniverseId && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: '#0A1628',
            border: '2px solid #10B981',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <h2 style={{ color: '#10B981', marginBottom: '16px', fontSize: '24px' }}>
              🔬 Atomize Universe
            </h2>

            <div style={{ color: '#E5E7EB', marginBottom: '24px', lineHeight: '1.6' }}>
              <p style={{ marginBottom: '12px' }}>
                This will create separate universes from each L1 node in:
              </p>
              <p style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#00FFD4',
                marginBottom: '16px',
                padding: '12px',
                backgroundColor: 'rgba(0, 255, 212, 0.1)',
                borderRadius: '8px'
              }}>
                {universeLibrary[selectedUniverseId].title}
              </p>

              {(() => {
                const l1Nodes = getL1Nodes(selectedUniverseId);
                return (
                  <>
                    <p style={{ marginBottom: '16px' }}>
                      <strong>{l1Nodes.length} L1 nodes</strong> will be atomized into separate universes.
                    </p>

                    {l1Nodes.length > 0 && (
                      <>
                        <p style={{ marginBottom: '12px', color: '#9CA3AF' }}>
                          New universes will be created:
                        </p>
                        <div style={{
                          maxHeight: '200px',
                          overflow: 'auto',
                          backgroundColor: '#050A1E',
                          borderRadius: '8px',
                          padding: '12px',
                          marginBottom: '16px'
                        }}>
                          {l1Nodes.map((node, index) => (
                            <div
                              key={node.id}
                              style={{
                                padding: '8px',
                                marginBottom: '8px',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                borderLeft: '3px solid #10B981',
                                borderRadius: '4px',
                                fontSize: '14px'
                              }}
                            >
                              {index + 1}. {node.semanticTitle || node.content.substring(0, 60)}
                              {node.content.length > 60 ? '...' : ''}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <p style={{
                      padding: '12px',
                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                      borderRadius: '8px',
                      fontSize: '14px',
                      marginBottom: '16px'
                    }}>
                      📁 All new universes will be saved in the <strong>&quot;Atomized&quot;</strong> folder.
                    </p>

                    <p style={{ color: '#9CA3AF', fontSize: '14px' }}>
                      ℹ️ The original universe will remain intact.
                    </p>
                  </>
                );
              })()}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleAtomizeConfirm}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#10B981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                🔬 Confirm Atomize
              </button>

              <button
                onClick={() => setShowAtomizeModal(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: 'transparent',
                  color: '#9CA3AF',
                  border: '2px solid #4B5563',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Spinner Overlay with Progress */}
      {isAtomizing && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10001,
          padding: '20px'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            border: '8px solid rgba(16, 185, 129, 0.2)',
            borderTop: '8px solid #10B981',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>

          <p style={{
            marginTop: '24px',
            color: '#10B981',
            fontSize: '24px',
            fontWeight: 'bold'
          }}>
            🔬 Atomizing Universe
          </p>

          {/* Progress Bar */}
          {atomizeProgress.total > 0 && (
            <div style={{
              width: '400px',
              marginTop: '20px',
              backgroundColor: '#1F2937',
              borderRadius: '10px',
              overflow: 'hidden',
              height: '30px',
              border: '2px solid #374151'
            }}>
              <div style={{
                width: `${(atomizeProgress.current / atomizeProgress.total) * 100}%`,
                height: '100%',
                backgroundColor: '#10B981',
                transition: 'width 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '14px',
                fontWeight: 'bold'
              }}>
                {atomizeProgress.current} / {atomizeProgress.total}
              </div>
            </div>
          )}

          {/* Status Text */}
          <p style={{
            marginTop: '16px',
            color: '#D1D5DB',
            fontSize: '16px',
            textAlign: 'center',
            maxWidth: '600px',
            lineHeight: '1.5'
          }}>
            {atomizeProgress.status || 'Creating separate universes from L1 nodes...'}
          </p>

          {/* Error Count */}
          {atomizeProgress.errors.length > 0 && (
            <p style={{
              marginTop: '12px',
              color: '#EF4444',
              fontSize: '14px'
            }}>
              ⚠️ {atomizeProgress.errors.length} error{atomizeProgress.errors.length > 1 ? 's' : ''} encountered
            </p>
          )}

          {/* Estimated Time */}
          {atomizeProgress.total > 0 && atomizeProgress.current < atomizeProgress.total && (
            <p style={{
              marginTop: '12px',
              color: '#9CA3AF',
              fontSize: '14px'
            }}>
              Estimated time remaining: ~{Math.ceil((atomizeProgress.total - atomizeProgress.current) * 10 / 60)} min
            </p>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: '#0A1628',
            border: '2px solid #00FFD4',
            borderRadius: '8px',
            padding: '8px 0',
            zIndex: 10000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
          }}
        >
          <button
            onClick={() => {
              const universe = universeLibrary[contextMenu.universeId];
              handleRename(contextMenu.universeId, universe.title);
            }}
            style={{
              width: '100%',
              padding: '12px 20px',
              backgroundColor: 'transparent',
              color: 'white',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1a2942'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            ✏️ Rename Universe
          </button>
        </div>
      )}
    </div>
  );
}
