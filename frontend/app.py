import os
import re
import sys
import queue
import asyncio
import threading
from typing import List, Optional
import uuid

# Prevent UnicodeEncodeError on Windows terminals
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

# Add the parent directory (root of the workspace) to the Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import core.config  # Load environment variables (.env) before anything else

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db, SessionLocal
from core.models import User, ResearchSession, ResearchFinding
from core.auth import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    get_user_by_email,
    get_current_user
)
from core.graph import build_research_graph
from agents.triage import verify_query

app = FastAPI(title="ResearchMind Interface")

# Mount static files folder
app.mount("/static", StaticFiles(directory="frontend/static"), name="static")


@app.get("/")
def read_root():
    """Serves the public landing page."""
    return FileResponse("frontend/static/home.html")


@app.get("/login")
def read_login():
    """Serves the auth/login gateway into the app."""
    return FileResponse("frontend/static/index.html")


@app.get("/app")
def read_app():
    """Serves the main research dashboard."""
    return FileResponse("frontend/static/index.html")


@app.get("/downloads")
def read_downloads():
    """Serves the user downloads and dossier library page."""
    return FileResponse("frontend/static/index.html")


# ──────────────────────────────────────────────
#  AUTH DEPENDENCY
# ──────────────────────────────────────────────
def get_authenticated_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> User:
    """Dependency to extract user from Authorization: Bearer <token>."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication token required")
    token = authorization.split(" ")[1]
    user = get_current_user(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please log in again.")
    return user


def get_admin_user(
    current_user: User = Depends(get_authenticated_user)
) -> User:
    """Dependency that ensures the authenticated user is an admin."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user


# ──────────────────────────────────────────────
#  AUTH SCHEMAS & ENDPOINTS
# ──────────────────────────────────────────────
class RegisterRequest(BaseModel):
    full_name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
def register_user(request: RegisterRequest, db: Session = Depends(get_db)):
    """Registers a new standard user with a hashed password."""
    email = request.email.lower().strip()
    if len(request.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    
    existing = get_user_by_email(db, email)
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
    
    new_user = User(
        email=email,
        hashed_password=hash_password(request.password),
        full_name=request.full_name.strip() or "User",
        role="user",
        is_active=True
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    token = create_access_token(new_user)
    return {
        "token": token,
        "user": {
            "id": str(new_user.id),
            "email": new_user.email,
            "full_name": new_user.full_name,
            "role": new_user.role
        }
    }


@app.post("/api/auth/login")
def login_user(request: LoginRequest, db: Session = Depends(get_db)):
    """Validates credentials and returns a 24h JWT token."""
    email = request.email.lower().strip()
    user = get_user_by_email(db, email)
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Your account has been deactivated. Contact an administrator.")
    
    token = create_access_token(user)
    return {
        "token": token,
        "user": {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role
        }
    }


@app.get("/api/auth/me")
def get_current_user_profile(user: User = Depends(get_authenticated_user)):
    """Returns profile for currently active session token."""
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "created_at": user.created_at.isoformat() if user.created_at else None
    }


# ──────────────────────────────────────────────
#  USER RESEARCH HISTORY (PostgreSQL)
# ──────────────────────────────────────────────
@app.get("/api/user/sessions")
def get_user_research_sessions(
    user: User = Depends(get_authenticated_user),
    db: Session = Depends(get_db)
):
    """Fetches all past research dossiers owned by the logged-in user."""
    sessions = (
        db.query(ResearchSession)
        .filter(ResearchSession.user_id == user.id)
        .order_by(ResearchSession.created_at.desc())
        .all()
    )
    return [
        {
            "id": str(s.id),
            "topic": s.topic,
            "status": s.status,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "has_report": bool(s.synthesized_report)
        }
        for s in sessions
    ]


@app.get("/api/user/sessions/{session_id}")
def get_session_detail(
    session_id: str,
    user: User = Depends(get_authenticated_user),
    db: Session = Depends(get_db)
):
    """Loads a specific research dossier and findings from PostgreSQL."""
    try:
        s_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    
    # Query session (allow admins to view any session, users only their own)
    query = db.query(ResearchSession).filter(ResearchSession.id == s_uuid)
    if user.role != "admin":
        query = query.filter(ResearchSession.user_id == user.id)
    
    session = query.first()
    if not session:
        raise HTTPException(status_code=404, detail="Research session not found")
    
    return {
        "id": str(session.id),
        "topic": session.topic,
        "status": session.status,
        "report": session.synthesized_report,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "findings": [
            {
                "subquery": f.subquery,
                "researcher_id": f.researcher_id,
                "model_used": f.model_used,
                "summary": f.summary,
                "sources": f.sources or [],
                "confidence": f.confidence,
                "arbitrator_accepted": f.arbitrator_accepted
            }
            for f in session.findings
        ]
    }


@app.get("/api/user/sessions/{session_id}/download")
def download_session_markdown(
    session_id: str,
    user: User = Depends(get_authenticated_user),
    db: Session = Depends(get_db)
):
    """Directly downloads the synthesized dossier report as a markdown attachment."""
    try:
        s_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")

    query = db.query(ResearchSession).filter(ResearchSession.id == s_uuid)
    if user.role != "admin":
        query = query.filter(ResearchSession.user_id == user.id)

    session = query.first()
    if not session or not session.synthesized_report:
        raise HTTPException(status_code=404, detail="Dossier report not found or empty")

    clean_title = re.sub(r'[^a-zA-Z0-9_\- ]+', '', session.topic).strip().replace(" ", "_")[:50]
    filename = f"ResearchDossier_{clean_title}.md"

    return Response(
        content=session.synthesized_report.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ──────────────────────────────────────────────
#  FILESYSTEM HISTORY FALLBACK (For guests)
# ──────────────────────────────────────────────
@app.get("/api/history")
def get_filesystem_history():
    """Returns past reports from reports/ directory when not logged in."""
    reports_dir = "reports"
    if not os.path.exists(reports_dir):
        return []
    
    files = []
    try:
        for f in os.listdir(reports_dir):
            if f.endswith(".md") and f.startswith("report_"):
                path = os.path.join(reports_dir, f)
                stat = os.stat(path)
                title = f.replace("report_", "").replace(".md", "").replace("_", " ")
                files.append({
                    "filename": f,
                    "title": title,
                    "sizeBytes": stat.st_size,
                    "createdTime": stat.st_mtime
                })
        files.sort(key=lambda x: x["createdTime"], reverse=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    return files


@app.get("/api/history/load")
def load_filesystem_report(filename: str):
    """Loads a specific markdown report file for guests."""
    filename = os.path.basename(filename)
    path = os.path.join("reports", filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Report file not found")
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"filename": filename, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  ADMIN TELEMETRY & MANAGEMENT ENDPOINTS
# ──────────────────────────────────────────────
@app.get("/api/admin/stats")
def get_admin_stats(
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Platform-wide analytics for administrator view."""
    total_users = db.query(User).count()
    total_sessions = db.query(ResearchSession).count()
    completed_sessions = db.query(ResearchSession).filter(ResearchSession.status == "completed").count()
    total_findings = db.query(ResearchFinding).count()
    
    return {
        "total_users": total_users,
        "total_sessions": total_sessions,
        "completed_sessions": completed_sessions,
        "total_findings": total_findings
    }


@app.get("/api/admin/users")
def get_all_users_admin(
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """List all registered users with session counts."""
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "full_name": u.full_name,
            "role": u.role,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "session_count": len(u.sessions)
        }
        for u in users
    ]


@app.get("/api/admin/sessions")
def get_all_sessions_admin(
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Browse recent research dossiers platform-wide."""
    sessions = db.query(ResearchSession).order_by(ResearchSession.created_at.desc()).limit(50).all()
    return [
        {
            "id": str(s.id),
            "user_email": s.owner.email if s.owner else "Unknown",
            "topic": s.topic,
            "status": s.status,
            "created_at": s.created_at.isoformat() if s.created_at else None
        }
        for s in sessions
    ]


# ──────────────────────────────────────────────
#  INPUT TRIAGE ENDPOINT
# ──────────────────────────────────────────────
class ValidateRequest(BaseModel):
    query: str


@app.post("/api/validate")
def validate_query(request: ValidateRequest):
    """
    Fast triage endpoint — runs heuristic + LLM checks on the user's input
    BEFORE the WebSocket pipeline is started. Returns is_valid and reason.
    """
    query = request.query.strip()
    if not query:
        return {"is_valid": False, "reason": "Query cannot be empty."}
    
    result = verify_query(query)
    return result


# ──────────────────────────────────────────────
#  REAL-TIME RESEARCH WEBSOCKET (Saves to Postgres)
# ──────────────────────────────────────────────
@app.websocket("/ws/research")
async def websocket_research(websocket: WebSocket):
    """Handles real-time research query streaming over WebSockets and saves to PostgreSQL."""
    await websocket.accept()
    
    try:
        # Wait for the client to send the query + optional token
        data = await websocket.receive_json()
        user_query = (data.get("query") or "").strip()
        raw_token = data.get("token") or ""
        auth_token = raw_token.strip() if isinstance(raw_token, str) else ""
        
        if not user_query:
            await websocket.send_json({"event": "error", "message": "Query cannot be empty"})
            await websocket.close()
            return

        # STRICT AUTHENTICATION: Require a valid user session
        db = SessionLocal()
        user = get_current_user(db, auth_token) if auth_token else None
        if not user:
            db.close()
            await websocket.send_json({
                "event": "error",
                "message": "Authentication required. Please sign in or create an account to start research."
            })
            await websocket.close()
            return
        
        # Create research session record in PostgreSQL linked directly to this user
        research_session = ResearchSession(
            user_id=user.id,
            topic=user_query,
            status="in_progress"
        )
        db.add(research_session)
        db.commit()
        db.refresh(research_session)
        session_id_str = str(research_session.id)
        db.close()
            
        progress_queue = queue.Queue()
        result_holder = {}
        
        # Build graph
        graph = build_research_graph()
        
        # Target thread function to run the LangGraph pipeline
        def run_pipeline():
            try:
                final_state = graph.invoke({
                    "user_query": user_query,
                    "subqueries": [],
                    "current_subquery_index": 0,
                    "current_retry_count": 0,
                    "current_researcher_outputs": [],
                    "arbitrator_verdicts": [],
                    "final_results": [],
                    "progress_queue": progress_queue
                })
                report = final_state.get("synthesized_report", "")
                result_holder["synthesized_report"] = report
                result_holder["final_state"] = final_state
                
                # 1. Save markdown backup to disk
                if report:
                    os.makedirs("reports", exist_ok=True)
                    safe_query = re.sub(r'[^a-zA-Z0-9_\-]+', '_', user_query).strip('_')[:50]
                    filename = f"reports/report_{safe_query}.md"
                    with open(filename, "w", encoding="utf-8") as f:
                        f.write(report)
                        
                # 2. Persist final report and all telemetry findings to PostgreSQL
                if session_id_str:
                    persist_db = SessionLocal()
                    try:
                        sess = persist_db.query(ResearchSession).filter(ResearchSession.id == uuid.UUID(session_id_str)).first()
                        if sess:
                            sess.synthesized_report = report
                            sess.status = "completed" if report else "failed"
                            
                            # Save all researcher findings across all subqueries
                            final_results = final_state.get("final_results", [])
                            for res in final_results:
                                finding = ResearchFinding(
                                    session_id=sess.id,
                                    subquery=res.subquery,
                                    researcher_id=res.chosen_researcher_id,
                                    model_used=res.model_used,
                                    summary=res.summary,
                                    sources=res.sources,
                                    confidence=res.confidence,
                                    arbitrator_accepted=True
                                )
                                persist_db.add(finding)
                            persist_db.commit()
                    except Exception as db_err:
                        print(f"[DB Error] Failed to persist session findings: {db_err}")
                    finally:
                        persist_db.close()

            except Exception as e:
                # Mark session failed if error
                if session_id_str:
                    persist_db = SessionLocal()
                    try:
                        sess = persist_db.query(ResearchSession).filter(ResearchSession.id == uuid.UUID(session_id_str)).first()
                        if sess:
                            sess.status = "failed"
                            persist_db.commit()
                    except:
                        pass
                    finally:
                        persist_db.close()
                progress_queue.put({"event": "error", "message": str(e)})
            finally:
                progress_queue.put({"event": "complete", "message": "done"})
                
        # Start the pipeline thread
        thread = threading.Thread(target=run_pipeline, daemon=True)
        thread.start()
        
        # Stream events from progress_queue to the client via WebSocket
        while True:
            item = await asyncio.to_thread(progress_queue.get)
            
            if item["event"] == "complete":
                report = result_holder.get("synthesized_report", "")
                await websocket.send_json({
                    "event": "complete",
                    "message": "Research complete!",
                    "report": report,
                    "session_id": session_id_str
                })
                break
            elif item["event"] == "error":
                await websocket.send_json({
                    "event": "error",
                    "message": item["message"]
                })
                break
            else:
                await websocket.send_json(item)
                
    except WebSocketDisconnect:
        print("[WebSocket] Client disconnected")
    except Exception as e:
        print(f"[WebSocket] Error: {e}")
        try:
            await websocket.send_json({"event": "error", "message": str(e)})
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass


if __name__ == "__main__":
    import uvicorn
    import webbrowser
    
    def open_browser():
        import time
        time.sleep(1.5)
        print("\n[Browser] Opening http://127.0.0.1:8000 in your default browser...")
        webbrowser.open("http://127.0.0.1:8000")

    # Start browser opener thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Start the server on port 8000
    uvicorn.run(app, host="127.0.0.1", port=8000)
