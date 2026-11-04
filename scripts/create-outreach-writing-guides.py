from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


OUT = Path("outreach-writing-guides")
OUT.mkdir(exist_ok=True)

GREEN = "1E5741"
PALE = "EAF2EE"
GRAY = "666666"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_cell_margins(cell, top=110, start=130, bottom=110, end=130):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def keep_with_next(p):
    p.paragraph_format.keep_with_next = True


def remove_paragraph_borders(p):
    p_pr = p._p.get_or_add_pPr()
    borders = p_pr.find(qn("w:pBdr"))
    if borders is not None:
        p_pr.remove(borders)


def setup_doc(title, subtitle):
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Inches(8.5)
    sec.page_height = Inches(11)
    sec.top_margin = Inches(0.72)
    sec.bottom_margin = Inches(0.72)
    sec.left_margin = Inches(0.8)
    sec.right_margin = Inches(0.8)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Aptos"
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor(0, 0, 0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.08

    styles["Title"].font.name = "Aptos Display"
    styles["Title"].font.size = Pt(27)
    styles["Title"].font.bold = True
    styles["Title"].font.color.rgb = RGBColor(0, 0, 0)
    styles["Title"].paragraph_format.space_after = Pt(10)
    title_ppr = styles["Title"]._element.get_or_add_pPr()
    title_borders = title_ppr.find(qn("w:pBdr"))
    if title_borders is not None:
        title_ppr.remove(title_borders)
    for name, size in (("Heading 1", 17), ("Heading 2", 13)):
        styles[name].font.name = "Aptos Display"
        styles[name].font.size = Pt(size)
        styles[name].font.bold = True
        styles[name].font.color.rgb = RGBColor(0, 0, 0)
        styles[name].paragraph_format.space_before = Pt(13)
        styles[name].paragraph_format.space_after = Pt(5)

    p = doc.add_paragraph(style="Title")
    p.add_run(title)
    remove_paragraph_borders(p)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = p.add_run(subtitle)
    r.bold = True
    r.font.color.rgb = RGBColor.from_string(GREEN)
    p.paragraph_format.space_after = Pt(14)
    return doc


def add_intro(doc, text):
    p = doc.add_paragraph(text)
    p.paragraph_format.space_after = Pt(10)


def add_bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.add_run(item)
        p.paragraph_format.space_after = Pt(3)


def add_steps(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Number")
        run = p.add_run(item)
        run.font.size = Pt(10.5)
        p.paragraph_format.space_after = Pt(2)


def add_school_rule(doc):
    doc.add_heading("Choose the school introduction", level=1)
    for item in [
        "For a state close to Wisconsin, use: My name is William Zhang, and I am a student at the University of Wisconsin–Madison.",
        "For a state close to Georgia, use: My name is William Zhang, and I am a student at Darlington School in Rome, Georgia.",
        "Use only one introduction. If the state is not clearly closer to either Wisconsin or Georgia, confirm the choice with William before finalizing the email.",
    ]:
        p = doc.add_paragraph(style="List Bullet")
        run = p.add_run(item)
        run.font.size = Pt(10.5)
        p.paragraph_format.space_after = Pt(2)


def add_field_table(doc, rows):
    table = doc.add_table(rows=1, cols=2)
    table.autofit = False
    table.columns[0].width = Inches(1.75)
    table.columns[1].width = Inches(5.1)
    hdr = table.rows[0].cells
    hdr[0].text = "Field"
    hdr[1].text = "Requirement"
    for c in hdr:
        set_cell_shading(c, GREEN)
        set_cell_margins(c)
        for r in c.paragraphs[0].runs:
            r.font.bold = True
            r.font.color.rgb = RGBColor(255, 255, 255)
    for i, (a, b) in enumerate(rows):
        cells = table.add_row().cells
        cells[0].text = a
        cells[1].text = b
        if i % 2:
            set_cell_shading(cells[0], PALE)
            set_cell_shading(cells[1], PALE)
        for c in cells:
            set_cell_margins(c)
            c.vertical_alignment = 1
    doc.add_paragraph()


def add_template(doc, template):
    h = doc.add_heading("Email template", level=1)
    keep_with_next(h)
    p = doc.add_paragraph("Replace every bracketed field, then remove all brackets. Preserve the paragraph order, subject line, punctuation pattern, and signature unless William explicitly approves a change.")
    p.paragraph_format.space_after = Pt(10)
    for block in template.split("\n\n"):
        p = doc.add_paragraph()
        for line_i, line in enumerate(block.split("\n")):
            if line_i:
                p.add_run().add_break()
            run = p.add_run(line)
            run.font.size = Pt(10.5)
            if block.startswith("Subject:"):
                run.bold = True
        p.paragraph_format.space_after = Pt(5)
        p.paragraph_format.line_spacing = 1.03


def add_final_check(doc, extra):
    h = doc.add_heading("Final review checklist", level=1)
    keep_with_next(h)
    checks = [
        "The organization name is consistent, and the recipient is an official, verified address rather than a guessed address.",
        "The subject is exactly Partnership Request from AbilityMade, and all bracketed placeholders have been replaced.",
        "Claims about the recipient are supported by the recorded official source URLs.",
        "The body contains one signature only and ends with abilitymade@gmail.com and abilitymade.net.",
        "The email is reviewed by a human before it is approved for draft, and the Gmail draft is inspected before approval to send.",
    ] + extra
    for text in checks:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.25)
        p.paragraph_format.first_line_indent = Inches(-0.22)
        p.add_run("☐ ").bold = True
        run = p.add_run(text)
        run.font.size = Pt(10.5)
        p.paragraph_format.space_after = Pt(2)


def footer(doc, label):
    for sec in doc.sections:
        p = sec.footer.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(f"AbilityMade  |  {label}")
        r.font.name = "Aptos"
        r.font.size = Pt(9)
        r.font.color.rgb = RGBColor.from_string(GRAY)


SUPPLIER_TEMPLATE = """Subject: Partnership Request from AbilityMade

Dear [CONTACT NAME OR ORGANIZATION TEAM],

[APPROVED SCHOOL INTRODUCTION SENTENCE] I help run AbilityMade, a student-led nonprofit organization.

AbilityMade helps artists in [STATE] with disabilities promote their [ARTWORK AND PRODUCTS / PRODUCTS]. We want to partner with [ORGANIZATION NAME] and help promote [YOUR / YOUR ARTISTS’] [WORK / PRODUCTS] to a wider audience.

We are really impressed by [ONE ACCURATE ORGANIZATION-SPECIFIC SENTENCE DESCRIBING ITS WORK AND PRODUCTS]. With your permission, we would be glad to feature [ARTWORK AND PRODUCTS / PRODUCTS] from [ORGANIZATION NAME / YOUR ARTISTS] on the AbilityMade website and promote them at no cost through Instagram, X, Facebook, TikTok, and YouTube.

AbilityMade would not retain any profit from these sales. All proceeds would go back to [ORGANIZATION NAME] [AND THE PARTICIPATING ARTISTS, IF APPLICABLE].

We would really appreciate the opportunity to partner with [ORGANIZATION NAME], and we look forward to hearing from you.

Sincerely,
William Zhang
AbilityMade
Email: abilitymade@gmail.com
Website: abilitymade.net"""

HOTEL_TEMPLATE = """Subject: Partnership Request from AbilityMade

Dear [HOTEL NAME],

[APPROVED SCHOOL INTRODUCTION SENTENCE] I help run AbilityMade, a student-led nonprofit organization.

AbilityMade helps artists in [STATE] with disabilities promote and sell their crafts through our website and social media, including Instagram, X, YouTube, and TikTok. We are also developing small in-person displays and would love the opportunity to host one in the lobby of [HOTEL NAME].

The display would operate as a silent auction. Guests who are interested in a product could submit a bid, with a minimum price set for each item. AbilityMade would handle the display and sales process.

We really appreciate [HOTEL NAME]’s involvement in community and charitable activities, and we believe this could be a meaningful way to support artists with disabilities. AbilityMade would keep no profit, and all proceeds would go back to the participating artists.

We would greatly appreciate the opportunity to work with [HOTEL NAME] and look forward to hearing from you.

Sincerely,
William Zhang
AbilityMade
Email: abilitymade@gmail.com
Website: abilitymade.net"""

OUTLET_TEMPLATE = """Subject: Partnership Request from AbilityMade

Dear [OUTLET OR SHOPPING MALL NAME]:

[APPROVED SCHOOL INTRODUCTION SENTENCE] I help run AbilityMade, a [STATE] student-led nonprofit organization.

AbilityMade helps artists in [STATE] with disabilities promote and sell their crafts through our website and social media, including Instagram, X, YouTube, and TikTok. We are also developing small in-person displays and would love the opportunity to host one in [OUTLET OR SHOPPING MALL NAME].

We would like to request a 6-by-6-foot display area with a table, and we would handle the setup and management of the exhibition. The display would operate as a silent auction. Guests who are interested in a product could write their bid on a bidding form, with a minimum price set for each item. At the end of the exhibition, the item would go to the person who submitted the highest bid. AbilityMade would take care of setting up the display and managing the entire auction and sales process.

We really appreciate [OUTLET OR SHOPPING MALL NAME]’s involvement in community and charitable activities, and we believe this could be a meaningful way to support artists with disabilities. AbilityMade would keep no profit, and all proceeds would go back to the participating artists.

We would greatly appreciate the opportunity to work with [OUTLET OR SHOPPING MALL NAME] and look forward to hearing from you.

Sincerely,

William Zhang

AbilityMade

Email: abilitymade@gmail.com

Website: abilitymade.net"""


def supplier_doc():
    doc = setup_doc("AbilityMade Supplier Outreach Email Guide", "Instructions and reusable template for supplier partnership outreach")
    add_intro(doc, "Use this guide to prepare individualized partnership emails for disability-serving studios, organizations, social enterprises, and entrepreneurs whose artwork or products may be promoted through AbilityMade. The goal is to invite a supplier relationship without implying that outreach or a reply already constitutes an agreement.")
    doc.add_heading("Research before writing", level=1)
    add_bullets(doc, [
        "Use the organization’s official website and official contact page as the primary sources.",
        "Confirm that the organization or entrepreneur is connected to disability-inclusive artwork, products, training, or employment.",
        "Record the exact organization name, official recipient address, contact person when available, product type, program description, and source URLs.",
        "Do not guess an email address. If no verified address exists, leave the organization out of the batch.",
        "Check the supplier queue for duplicate recipients before adding a new record.",
    ])
    doc.add_heading("How to personalize the email", level=1)
    add_field_table(doc, [
        ("Greeting", "Use the verified contact’s name when appropriate; otherwise use Dear [Organization] Team,."),
        ("Introduction", "Choose the school sentence by state proximity using the rule below. Do not combine the two school introductions."),
        ("State", "Name the state where the artists are based. The sentence must begin AbilityMade helps artists in [State] with disabilities."),
        ("Products", "Use artwork and products or products based on what the organization actually offers."),
        ("Specific praise", "Write one factual sentence about the organization’s products, mission, training, employment, studio, exhibitions, or marketplace."),
        ("Proceeds", "Name the organization and, when accurate, the participating artists. Do not invent financial terms."),
    ])
    add_school_rule(doc)
    doc.add_heading("Writing process", level=1)
    add_steps(doc, [
        "Collect verified facts and source URLs before drafting.",
        "Copy the template and replace every bracketed field with organization-specific information.",
        "Read the complete email for factual accuracy, natural grammar, consistent names, and correct apostrophes.",
        "Save the finalized recipient, subject, body, and source URLs in the outreach file or approval queue.",
        "Treat the finalized text as the source of truth; later automation must not rewrite it.",
    ])
    add_template(doc, SUPPLIER_TEMPLATE)
    add_final_check(doc, [
        "The first sentence of the second body paragraph begins AbilityMade helps artists in [State] with disabilities, using the correct state.",
        "The email contains exactly one approved school introduction selected by state proximity.",
        "The email does not claim that the recipient is already an AbilityMade supplier.",
    ])
    footer(doc, "Supplier Outreach Email Guide")
    return doc


def hotel_doc():
    doc = setup_doc("AbilityMade Hotel Outreach Email Guide", "Instructions and reusable template for hotel exhibition outreach")
    add_intro(doc, "Use this guide to invite a hotel to host a small AbilityMade display in its lobby. The proposed hotel display is a silent auction managed by AbilityMade. It is not the 6-by-6-foot outlet setup, so do not add an exhibition-size request or a table requirement.")
    doc.add_heading("Research before writing", level=1)
    add_bullets(doc, [
        "Use the hotel’s official property website and official meetings, events, sales, community, or contact pages.",
        "Verify the property’s exact public name, state, and a suitable official sales, events, community, concierge, or general contact address.",
        "Confirm any statement about community or charitable involvement before making it more specific than the template.",
        "Do not guess an address or substitute a corporate address without confirming that it serves the property.",
        "Check the hotel queue for duplicates before adding a new record.",
    ])
    doc.add_heading("Required content choices", level=1)
    add_field_table(doc, [
        ("Greeting", "Use Dear [Hotel Name], with the exact property name."),
        ("Introduction", "Choose the school sentence by state proximity using the rule below. Do not combine the two school introductions."),
        ("State", "Replace every state placeholder with the hotel property’s state. The sentence must begin AbilityMade helps artists in [State] with disabilities."),
        ("Location request", "Ask to host a small in-person display in the hotel lobby."),
        ("Display model", "Describe a silent auction with minimum prices and AbilityMade handling the display and sales process."),
        ("Do not include", "Do not mention a 6-by-6-foot area or table; those details belong only to outlet and shopping mall outreach."),
    ])
    add_school_rule(doc)
    doc.add_heading("Writing process", level=1)
    add_steps(doc, [
        "Verify the hotel name, recipient, and source URLs.",
        "Replace every hotel-name and state placeholder consistently throughout the template.",
        "Check the possessive form of the hotel name and make sure the lobby reference reads naturally.",
        "Save the complete finalized email in the hotel approval queue with its official sources.",
        "Require separate human approvals for draft creation and sending.",
    ])
    add_template(doc, HOTEL_TEMPLATE)
    add_final_check(doc, [
        "The first sentence of the second body paragraph begins AbilityMade helps artists in [State] with disabilities, using the correct state.",
        "The email contains exactly one approved school introduction selected by state proximity.",
        "The email contains no 6-by-6-foot space or table request.",
    ])
    footer(doc, "Hotel Outreach Email Guide")
    return doc


def outlet_doc():
    doc = setup_doc("AbilityMade Outlet and Shopping Mall Outreach Email Guide", "Instructions and reusable template for exhibition space outreach")
    add_intro(doc, "Use this guide to ask an outlet center or shopping mall to host an AbilityMade exhibition and silent auction. This version requests a 6-by-6-foot display area with a table and states that AbilityMade will manage setup, bidding, and sales.")
    doc.add_heading("Research before writing", level=1)
    add_bullets(doc, [
        "Use the property’s official website and official management, specialty leasing, marketing, events, or contact page.",
        "Verify the exact property name, state, and an official recipient that can evaluate temporary exhibitions or community partnerships.",
        "Record the source URL for the recipient and any property-specific claim.",
        "Search the complete outlet queue before every import. One unique recipient address may receive only one outlet outreach email across the outlet history.",
        "If an address already exists, find a different verified official contact or exclude the property. Never guess an address or reuse a shared-recipient exception for a new batch.",
    ])
    doc.add_heading("Required content choices", level=1)
    add_field_table(doc, [
        ("Greeting", "Use Dear [Outlet or Shopping Mall Name]: and preserve the colon style."),
        ("Introduction", "Choose the school sentence by state proximity using the rule below. Do not combine the two school introductions."),
        ("State", "Replace both state placeholders with the property’s state; verify that the nonprofit description is accurate for the intended campaign wording."),
        ("Venue wording", "Use the property’s name naturally. Do not automatically append Outlet if it creates awkward wording."),
        ("Space request", "Request a 6-by-6-foot display area with a table."),
        ("Auction details", "Keep the bidding-form, minimum-price, highest-bidder, setup, management, and sales-process explanation."),
    ])
    add_school_rule(doc)
    doc.add_heading("Writing process", level=1)
    add_steps(doc, [
        "Verify the property, state, recipient, and source URLs.",
        "Check the recipient against every historical row in the outlet queue before drafting.",
        "Replace every bracketed field and read the venue references aloud for natural wording.",
        "Save the exact recipient, subject, body, and sources in the outlet approval queue.",
        "Require separate human approvals for draft creation and sending; a status color alone does not run the sender.",
    ])
    add_template(doc, OUTLET_TEMPLATE)
    add_final_check(doc, [
        "The state is correct in both places, the 6-by-6-foot area and table request are present, and the recipient does not appear elsewhere in the outlet queue history.",
        "The email contains exactly one approved school introduction selected by state proximity.",
    ])
    footer(doc, "Outlet and Shopping Mall Outreach Email Guide")
    return doc


docs = [
    (supplier_doc(), OUT / "AbilityMade_Supplier_Outreach_Email_Guide.docx"),
    (hotel_doc(), OUT / "AbilityMade_Hotel_Outreach_Email_Guide.docx"),
    (outlet_doc(), OUT / "AbilityMade_Outlet_and_Shopping_Mall_Outreach_Email_Guide.docx"),
]

for doc, path in docs:
    doc.save(path)
    print(path.resolve())
