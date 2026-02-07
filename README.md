# Masker

## Description

This is the repo for the web tool for labeling datasets with binary masks

## Getting Started

### 1. Start the backend

1. Install [miniconda](https://www.anaconda.com/docs/getting-started/miniconda/install#using-miniconda-in-a-commercial-setting)

2. Put the .pth model in the root directory of this repo. The link to the pretrained .pth model can be found on: https://drive.google.com/file/d/1vIFsQH1KoPzgORHK_1z78zkXNT9twslL/view

3. Run the following commands

```bash
# clone the repository
git clone https://github.com/Innowing-robotics-interns/masker.git

# create a new environment
conda env create -f environment.yml

# activate environment
conda activate masker

# run app
python app.py
```
You should see the following printed in the terminal

    Using device: cpu
    Using device: cpu
    * Serving Flask app 'app'
    * Debug mode: on
    WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead.
    * Running on all addresses (0.0.0.0)
    * Running on http://127.0.0.1:8000
    * Running on http://10.68.152.106:8000

3. By now you have launched the backend, and the old frontend (which you can try out by right clicking on *http://127.0.0.1:8000*).
4. Run the following commands to run the updated frontend (please ensure you have [Node.js](https://nodejs.org/en/download) installed on your system)
```bash
cd frontend

npm install

npm run dev
```

You will see the following output
```bash
> frontend@0.0.0 dev
> vite


  VITE v7.2.2  ready in 287 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

Go to http://localhost:5173/ to see the new frontend.

---

## Project Structure

```
masker/
├── environment.yml        # Conda environment (dependencies)
├── app.py                 # main Flask application and routes
├── predictor.py           # model inference logic wrapper
├── magic_pen_router.py    # blueprint for magic-pen mask editing
├── datasets/              # user data (each subfolder has images/ and labels/)
├── model/                 # model architectures:
├── public/                # static assets at /static:
│   ├── css/main.css       # styles
│   └── js/                # scripts:
│       ├── canvas.js      # drawing logic
│       ├── file_system.js # I/O helpers
│       ├── ui.js          # UI controls
│       └── main.js        # app entry point
└── templates/             # Jinja2 HTML views:
    ├── select_dataset.html # dataset picker
    └── index.html          # masking interface
```
