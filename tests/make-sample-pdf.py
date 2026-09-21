"""Builds tests/sample-resume.pdf - a tiny hand-assembled PDF (Helvetica text) used to
exercise the browser's PDF text extraction. Run: python tests/make-sample-pdf.py"""
import os

LINES = [
    "Aarav Sharma",
    "Bengaluru, India | aarav@example.com | github.com/aarav-dev | linkedin.com/in/aarav-sharma",
    "",
    "EDUCATION",
    "B.Tech in Computer Science, Example Institute of Technology, Expected 2026",
    "",
    "SKILLS",
    "Python, C++, JavaScript, TypeScript, React, Node.js, Express, MongoDB, PostgreSQL, Docker, Git",
    "Machine Learning, Deep Learning, PyTorch, scikit-learn, pandas, NumPy, NLP, LLM, RAG, LangChain",
    "",
    "PROJECTS",
    "Resume Ranker - built an NLP pipeline in Python and PyTorch; served with FastAPI and deployed on Docker.",
    "Trained a machine learning model with scikit-learn and PyTorch; tuned deep learning hyperparameters.",
    "Carbon Track - full stack app using React, Node.js, Express and MongoDB with REST APIs.",
    "",
    "EXPERIENCE",
    "Software Engineering Intern, Acme Labs (Jun 2025 - Aug 2025): built React dashboards, wrote Python services.",
]

def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

stream = ["BT", "/F1 10 Tf", "50 800 Td", "14 TL"]
for ln in LINES:
    stream.append("(%s) Tj T*" % esc(ln))
stream.append("ET")
content = "\n".join(stream).encode("latin-1")

objs = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
]
out = b"%PDF-1.4\n"
offsets = []
for i, o in enumerate(objs, 1):
    offsets.append(len(out))
    out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
xref = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
for off in offsets:
    out += b"%010d 00000 n \n" % off
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample-resume.pdf")
open(path, "wb").write(out)
print("wrote", path, len(out), "bytes")
