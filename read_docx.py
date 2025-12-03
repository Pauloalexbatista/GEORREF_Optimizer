import zipfile
import xml.etree.ElementTree as ET
import sys
import os

def read_docx(file_path):
    try:
        with zipfile.ZipFile(file_path) as docx:
            xml_content = docx.read('word/document.xml')
            tree = ET.fromstring(xml_content)
            
            # XML namespaces
            namespaces = {
                'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
            }
            
            text = []
            for paragraph in tree.findall('.//w:p', namespaces):
                para_text = []
                for run in paragraph.findall('.//w:r', namespaces):
                    for t in run.findall('.//w:t', namespaces):
                        if t.text:
                            para_text.append(t.text)
                if para_text:
                    text.append(''.join(para_text))
            
            return '\n'.join(text)
    except Exception as e:
        return f"Error reading docx: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) > 1:
        content = read_docx(sys.argv[1])
        with open('docx_content.txt', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Done writing to docx_content.txt")
    else:
        print("Usage: python read_docx.py <path_to_docx>")
